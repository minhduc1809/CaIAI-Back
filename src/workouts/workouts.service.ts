import { cfg } from '../system-config/config.holder';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutLogDto, CreateWorkoutExerciseDto } from './dto/create-workout-log.dto';
import { UpdateWorkoutLogDto } from './dto/update-workout-log.dto';
import { QueryWorkoutDto } from './dto/query-workout.dto';
import { WorkoutCategory } from '@prisma/client';
import {
  addDaysToKey,
  dateToKey,
  keyToDate,
  normalizeDayKey,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import {
  RecordValue,
  SetForRecords,
  computeRecords,
  exerciseKey,
  newRecordsOf,
} from './workout-records';
import {
  JumpWarning,
  WORKOUT_LIMITS,
  validateSession,
  weightJumpWarnings,
} from './workout-rules';

export interface MetConfig {
  met: number;
  nameVi: string;
  description: string;
}

export const MET_TABLE: Record<WorkoutCategory, MetConfig> = {
  RUNNING: {
    met: 9.8,
    nameVi: 'Chạy bộ',
    description: 'Chạy ngoài trời hoặc máy chạy bộ tốc độ ~8.5 km/h',
  },
  CYCLING: {
    met: 7.5,
    nameVi: 'Đạp xe',
    description: 'Đạp xe ngoài trời hoặc máy đạp xe cường độ vừa',
  },
  SWIMMING: {
    met: 8.0,
    nameVi: 'Bơi lội',
    description: 'Bơi sải hoặc bơi ếch nhịp độ liên tục',
  },
  HIIT: {
    met: 8.5,
    nameVi: 'HIIT / Tabata',
    description: 'Tập luyện ngắt quãng cường độ cao',
  },
  STRENGTH: {
    met: 5.0,
    nameVi: 'Tập tạ / Gym',
    description: 'Tập kháng lực, nâng tạ nghỉ giữa các hiệp',
  },
  SPORTS: {
    met: 7.0,
    nameVi: 'Thể thao đối kháng',
    description: 'Cầu lông, bóng đá, bóng rổ, tennis, võ thuật',
  },
  WALKING: {
    met: 3.8,
    nameVi: 'Đi bộ',
    description: 'Đi bộ nhanh tốc độ ~5 km/h',
  },
  YOGA: {
    met: 2.8,
    nameVi: 'Yoga / Giãn cơ',
    description: 'Hatha/Vinyasa yoga, kéo giãn cơ bắp',
  },
  CARDIO: {
    met: 6.5,
    nameVi: 'Cardio tổng hợp',
    description: 'Aerobic, nhảy dây, leo cầu thang',
  },
  OTHER: {
    met: 4.0,
    nameVi: 'Hoạt động thể chất khác',
    description: 'Lao động tay chân, vận động tự do',
  },
};

/**
 * MET hiệu lực của một loại tập: tham số hệ thống `workout.met.<LOẠI>` (admin sửa được), mặc định theo bảng trên.
 * Sửa MET chỉ áp cho buổi tập ghi sau đó, không tính lại buổi đã ghi (BR-10.5).
 */
export function metOf(category: WorkoutCategory): number {
  return MET_TABLE[category] ? cfg(`workout.met.${category}`) : WORKOUT_LIMITS.defaultMetIfUnknown;
}

const WORKOUT_INCLUDE = {
  exercises: {
    include: { sets: { orderBy: { setNumber: 'asc' as const } } },
    orderBy: { order: 'asc' as const },
  },
};

/** Khoá bài tập cho một bài trong DTO. */
const keyOfDto = (ex: CreateWorkoutExerciseDto) =>
  exerciseKey({ exerciseSource: ex.exerciseSource, exerciseRefId: ex.exerciseId, name: ex.name });

@Injectable()
export class WorkoutsService {
  private readonly logger = new Logger(WorkoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính toán năng lượng tiêu hao chuẩn theo hệ số MET và cân nặng người dùng
   * Công thức (net): Calo = (MET - 1) * weightKg * (durationMinutes / 60)
   */
  calculateCalories(
    category: WorkoutCategory,
    durationMinutes: number,
    userWeightKg: number,
  ): number {
    const met = metOf(category);
    // BR-10.5: calo tập NET = (MET − 1) × kg × giờ (MET gộp đã gồm cả năng lượng lúc nghỉ)
    const calories =
      Math.max(0, met - 1) * userWeightKg * (durationMinutes / 60);
    return Math.round(calories * 10) / 10;
  }

  /**
   * Lấy danh sách các loại bài tập kèm thông số MET để hiển thị trên UI
   */
  getCategories() {
    return Object.entries(MET_TABLE).map(([category, config]) => ({
      category: category as WorkoutCategory,
      nameVi: config.nameVi,
      met: metOf(category as WorkoutCategory),
      description: config.description,
    }));
  }

  private async getUserTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return resolveTimezone(user?.timezone);
  }

  /** Ngày tương lai theo múi giờ của người dùng không được ghi (BR-10.4), giống bữa ăn và cân nặng. */
  private assertNotFuture(dayKey: string, tz: string) {
    if (dayKey > todayKey(tz)) {
      throw new BadRequestException(
        'Không thể ghi buổi tập cho ngày trong tương lai',
      );
    }
  }

  private parseInstant(value: string | undefined, field: string): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} không hợp lệ`);
    }
    return d;
  }

  private exerciseRows(exercises: CreateWorkoutExerciseDto[]) {
    return exercises.map((ex, idx) => ({
      name: ex.name,
      order: ex.order !== undefined ? ex.order : idx,
      exerciseSource: ex.exerciseSource ?? null,
      exerciseRefId: ex.exerciseId ?? null,
      primaryMuscle: ex.primaryMuscle ?? null,
      restSec: ex.restSec ?? null,
      exerciseKey: keyOfDto(ex),
      sets: {
        create: ex.sets.map((s) => ({
          setNumber: s.setNumber,
          reps: s.reps,
          weightKg: s.weightKg,
          rpe: s.rpe ?? null,
          isWarmup: s.isWarmup ?? false,
          durationSec: s.durationSec ?? null,
          distanceM: s.distanceM ?? null,
        })),
      },
    }));
  }

  /** Dựng phản hồi buổi tập: kèm tổng volume kg (set không khởi động). */
  private present<T extends { exercises: any[] }>(workout: T) {
    return { ...workout, totalVolumeKg: this.calculateTotalVolume(workout.exercises) };
  }

  /**
   * Ghi nhận một buổi tập mới (BR-10.4): kiểm tra dữ liệu, chống ghi trùng theo `clientRequestId`, tính lại kỷ lục
   * của các bài trong buổi và trả về kỷ lục mới cùng cảnh báo mềm (tạ tăng đột biến).
   */
  async createWorkout(userId: string, dto: CreateWorkoutLogDto) {
    const {
      name,
      category,
      date,
      durationMinutes,
      caloriesBurned,
      rpe,
      note,
      exercises,
      clientRequestId,
    } = dto;

    // 0. Gửi lại cùng clientRequestId (mất mạng, retry) chỉ trả buổi đã có, không tạo thêm
    if (clientRequestId) {
      const existing = await this.prisma.workoutLog.findFirst({
        where: { userId, clientRequestId },
        include: WORKOUT_INCLUDE,
      });
      if (existing) {
        return { ...this.present(existing), newRecords: [], warnings: [], deduplicated: true };
      }
    }

    // 1. Kiểm tra quy tắc buổi tập: không đạt thì không lưu
    const problems = validateSession({ category, durationMinutes, exercises });
    if (problems.length > 0) throw new BadRequestException(problems.join('; '));
    const startedAt = this.parseInstant(dto.startedAt, 'startedAt');
    const endedAt = this.parseInstant(dto.endedAt, 'endedAt');
    if (startedAt && endedAt && endedAt < startedAt) {
      throw new BadRequestException('endedAt không được trước startedAt');
    }

    // 2. Cân nặng để tính calo nếu không nhập
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { weightKg: true },
    });
    const weightKg = user?.weightKg || 65;
    const finalCalories =
      caloriesBurned !== undefined && caloriesBurned !== null
        ? caloriesBurned
        : this.calculateCalories(category, durationMinutes, weightKg);

    const tz = await this.getUserTimezone(userId);
    const workoutDayKey = normalizeDayKey(date, tz);
    if (!workoutDayKey) throw new BadRequestException('date không hợp lệ');
    this.assertNotFuture(workoutDayKey, tz);
    const workoutDate = keyToDate(workoutDayKey);

    // 3. Kỷ lục trước buổi này, để biết kỷ lục nào mới
    const keys = this.keysOf(exercises ?? []);
    const before = await this.loadRecords(userId, [...keys.keys()]);

    // 4. Tạo buổi tập; hai request đồng thời cùng clientRequestId chỉ thắng một
    let workout;
    try {
      workout = await this.prisma.workoutLog.create({
        data: {
          userId,
          name,
          category,
          date: workoutDate,
          durationMinutes,
          caloriesBurned: finalCalories,
          rpe: rpe || null,
          note: note || null,
          clientRequestId: clientRequestId ?? null,
          startedAt,
          endedAt,
          exercises: exercises?.length
            ? { create: this.exerciseRows(exercises) }
            : undefined,
        },
        include: WORKOUT_INCLUDE,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002' && clientRequestId) {
        const winner = await this.prisma.workoutLog.findFirst({
          where: { userId, clientRequestId },
          include: WORKOUT_INCLUDE,
        });
        if (winner) {
          return { ...this.present(winner), newRecords: [], warnings: [], deduplicated: true };
        }
      }
      throw e;
    }

    // 5. Tính lại kỷ lục, báo kỷ lục mới và cảnh báo tạ tăng đột biến
    const newRecords = await this.refreshRecords(userId, keys, before);
    const warnings = this.jumpWarningsFor(exercises ?? [], before);

    return { ...this.present(workout), newRecords, warnings };
  }

  /** Các khoá bài trong danh sách (khoá → tên). */
  private keysOf(exercises: CreateWorkoutExerciseDto[]): Map<string, string> {
    const keys = new Map<string, string>();
    for (const ex of exercises) keys.set(keyOfDto(ex), ex.name);
    return keys;
  }

  private jumpWarningsFor(
    exercises: CreateWorkoutExerciseDto[],
    before: Map<string, RecordValue[]>,
  ): JumpWarning[] {
    const previousMax = new Map<string, number>();
    for (const [key, recs] of before) {
      const top = recs.find((r) => r.type === 'MAX_WEIGHT');
      if (top) previousMax.set(key, top.value);
    }
    const current = new Map<string, { key: string; name: string; maxWeightKg: number }>();
    for (const ex of exercises) {
      const key = keyOfDto(ex);
      const max = Math.max(0, ...ex.sets.filter((s) => !s.isWarmup).map((s) => s.weightKg));
      const cur = current.get(key);
      if (!cur || max > cur.maxWeightKg) current.set(key, { key, name: ex.name, maxWeightKg: max });
    }
    return weightJumpWarnings([...current.values()], previousMax);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Kỷ lục cá nhân (BR-10.8)
  // ──────────────────────────────────────────────────────────────────────

  /** Kỷ lục đang lưu của các bài, theo khoá bài. */
  private async loadRecords(userId: string, keys: string[]): Promise<Map<string, RecordValue[]>> {
    const out = new Map<string, RecordValue[]>(keys.map((k) => [k, []]));
    if (keys.length === 0) return out;
    try {
      const rows = await this.prisma.personalRecord.findMany({
        where: { userId, exerciseKey: { in: keys } },
      });
      for (const r of rows) {
        out.get(r.exerciseKey)?.push({
          type: r.type as RecordValue['type'],
          weightKey: r.weightKey,
          value: r.value,
          reps: r.reps,
          weightKg: r.weightKg,
          setId: r.setId ?? '',
          workoutId: r.workoutId ?? '',
          achievedAt: r.achievedAt,
        });
      }
    } catch (e) {
      this.logger.warn(`Không đọc được kỷ lục: ${(e as Error).message}`);
    }
    return out;
  }

  /**
   * Bài cũ ghi trước khi có khoá chưa có `exerciseKey`: điền khoá theo tên để gom vào đúng lịch sử và kỷ lục.
   */
  private async backfillExerciseKeys(userId: string) {
    const legacy = await this.prisma.workoutExercise.findMany({
      where: { exerciseKey: null, workoutLog: { userId } },
      select: { id: true, name: true, exerciseSource: true, exerciseRefId: true },
    });
    for (const ex of legacy) {
      await this.prisma.workoutExercise.update({
        where: { id: ex.id },
        data: { exerciseKey: exerciseKey(ex) },
      });
    }
  }

  /**
   * Tính lại kỷ lục của các bài đã chạm tới từ MỌI set không khởi động của người dùng, thay bảng kỷ lục của các bài
   * đó, và trả về kỷ lục mới so với `before`. Lỗi ở đây không được làm hỏng việc ghi/sửa/xoá buổi tập.
   */
  async refreshRecords(
    userId: string,
    keys: Map<string, string>,
    before?: Map<string, RecordValue[]>,
  ): Promise<(RecordValue & { exerciseKey: string; exerciseName: string })[]> {
    const fresh: (RecordValue & { exerciseKey: string; exerciseName: string })[] = [];
    try {
      if ([...keys.keys()].some((k) => k.startsWith('name:'))) {
        await this.backfillExerciseKeys(userId);
      }
      const previous = before ?? (await this.loadRecords(userId, [...keys.keys()]));
      for (const [key, name] of keys) {
        const sets = await this.prisma.workoutSet.findMany({
          where: { exercise: { exerciseKey: key, workoutLog: { userId } } },
          select: {
            id: true,
            reps: true,
            weightKg: true,
            isWarmup: true,
            exercise: { select: { workoutLogId: true, workoutLog: { select: { date: true } } } },
          },
        });
        const forRecords: SetForRecords[] = sets.map((s) => ({
          setId: s.id,
          workoutId: s.exercise.workoutLogId,
          weightKg: s.weightKg,
          reps: s.reps,
          isWarmup: s.isWarmup,
          achievedAt: s.exercise.workoutLog.date,
        }));
        const records = computeRecords(forRecords);
        await this.prisma.personalRecord.deleteMany({ where: { userId, exerciseKey: key } });
        if (records.length > 0) {
          await this.prisma.personalRecord.createMany({
            data: records.map((r) => ({
              userId,
              exerciseKey: key,
              exerciseName: name,
              type: r.type,
              weightKey: r.weightKey,
              value: r.value,
              reps: r.reps,
              weightKg: r.weightKg,
              setId: r.setId,
              workoutId: r.workoutId,
              achievedAt: r.achievedAt,
            })),
          });
        }
        for (const r of newRecordsOf(previous.get(key) ?? [], records)) {
          fresh.push({ ...r, exerciseKey: key, exerciseName: name });
        }
      }
    } catch (e) {
      this.logger.error(`Không tính lại được kỷ lục: ${(e as Error).message}`);
    }
    return fresh;
  }

  /**
   * Lấy danh sách buổi tập của người dùng theo bộ lọc
   */
  async getWorkouts(userId: string, query: QueryWorkoutDto) {
    const { date, startDate, endDate, category } = query;
    const where: any = { userId };

    if (category) {
      where.category = category;
    }

    // Buổi tập lưu theo ngày dạng YYYY-MM-DD (00:00 UTC) giống bữa ăn; ngày lọc tính theo múi giờ user (BR-07.2)
    const tz = await this.getUserTimezone(userId);
    if (date) {
      const key = normalizeDayKey(date, tz);
      if (!key) throw new BadRequestException('date không hợp lệ');
      where.date = {
        gte: keyToDate(key),
        lt: keyToDate(addDaysToKey(key, 1)),
      };
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        const key = normalizeDayKey(startDate, tz);
        if (!key) throw new BadRequestException('startDate không hợp lệ');
        where.date.gte = keyToDate(key);
      }
      if (endDate) {
        const key = normalizeDayKey(endDate, tz);
        if (!key) throw new BadRequestException('endDate không hợp lệ');
        where.date.lt = keyToDate(addDaysToKey(key, 1));
      }
    }

    const workouts = await this.prisma.workoutLog.findMany({
      where,
      include: WORKOUT_INCLUDE,
      orderBy: { date: 'desc' },
    });

    return workouts.map((w) => this.present(w));
  }

  /**
   * Lấy chi tiết một buổi tập
   */
  async getWorkoutById(userId: string, id: string) {
    const workout = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
      include: WORKOUT_INCLUDE,
    });

    if (!workout) {
      throw new NotFoundException(
        'Không tìm thấy buổi tập hoặc bạn không có quyền truy cập',
      );
    }

    return this.present(workout);
  }

  /**
   * Cập nhật buổi tập. Có `exercises` thì thay toàn bộ danh sách bài/set và tính lại kỷ lục của mọi bài liên quan
   * (cũ và mới). Sửa buổi cũ không giới hạn thời gian và không ảnh hưởng mục tiêu dinh dưỡng.
   */
  async updateWorkout(userId: string, id: string, dto: UpdateWorkoutLogDto) {
    const existing = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
      include: WORKOUT_INCLUDE,
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy buổi tập để cập nhật');
    }

    const { name, category, date, durationMinutes, caloriesBurned, rpe, note } =
      dto;

    // Kiểm tra quy tắc trên trạng thái SAU khi sửa
    const mergedExercises =
      dto.exercises ??
      existing.exercises.map((e) => ({
        name: e.name,
        sets: e.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup })),
      }));
    const problems = validateSession({
      category: category ?? existing.category,
      durationMinutes: durationMinutes ?? existing.durationMinutes,
      exercises: mergedExercises,
    });
    if (problems.length > 0) throw new BadRequestException(problems.join('; '));

    const tz = await this.getUserTimezone(userId);
    let newDate: Date | undefined;
    if (date) {
      const key = normalizeDayKey(date, tz);
      if (!key) throw new BadRequestException('date không hợp lệ');
      this.assertNotFuture(key, tz);
      newDate = keyToDate(key);
    }

    let finalCalories = existing.caloriesBurned;
    if (caloriesBurned !== undefined && caloriesBurned !== null) {
      finalCalories = caloriesBurned;
    } else if (category || durationMinutes) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { weightKg: true },
      });
      const weightKg = user?.weightKg || 65;
      const targetCategory = category || existing.category;
      const targetDuration = durationMinutes || existing.durationMinutes;
      finalCalories = this.calculateCalories(
        targetCategory,
        targetDuration,
        weightKg,
      );
    }

    const oldKeys = new Map<string, string>();
    for (const e of existing.exercises) {
      oldKeys.set(exerciseKey(e), e.name);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.exercises) {
        await tx.workoutExercise.deleteMany({ where: { workoutLogId: id } });
      }
      return tx.workoutLog.update({
        where: { id },
        data: {
          name: name || undefined,
          category: category || undefined,
          date: newDate,
          durationMinutes: durationMinutes || undefined,
          caloriesBurned: finalCalories,
          rpe: rpe !== undefined ? rpe : undefined,
          note: note !== undefined ? note : undefined,
          exercises: dto.exercises
            ? { create: this.exerciseRows(dto.exercises) }
            : undefined,
        },
        include: WORKOUT_INCLUDE,
      });
    });

    let newRecords: Awaited<ReturnType<WorkoutsService['refreshRecords']>> = [];
    if (dto.exercises || newDate) {
      const keys = new Map(oldKeys);
      for (const [k, n] of this.keysOf(dto.exercises ?? [])) keys.set(k, n);
      newRecords = await this.refreshRecords(userId, keys);
    }

    return { ...this.present(updated), newRecords };
  }

  /**
   * Xóa buổi tập; kỷ lục của các bài trong buổi được tính lại (xoá set đang giữ kỷ lục thì kỷ lục lùi về giá trị kế).
   */
  async deleteWorkout(userId: string, id: string) {
    const existing = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
      include: { exercises: { select: { name: true, exerciseSource: true, exerciseRefId: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy buổi tập để xóa');
    }

    await this.prisma.workoutLog.delete({
      where: { id },
    });

    const keys = new Map<string, string>();
    for (const e of existing.exercises) keys.set(exerciseKey(e), e.name);
    await this.refreshRecords(userId, keys);

    return {
      success: true,
      message: 'Đã xóa buổi tập thành công',
    };
  }

  /**
   * Tổng hợp hoạt động thể chất trong ngày (Active Calories, thời lượng, số buổi)
   */
  async getDailySummary(userId: string, dateStr?: string) {
    const tz = await this.getUserTimezone(userId);
    const dayKey = normalizeDayKey(dateStr, tz);
    if (!dayKey) throw new BadRequestException('date không hợp lệ');

    const workouts = await this.prisma.workoutLog.findMany({
      where: {
        userId,
        date: {
          gte: keyToDate(dayKey),
          lt: keyToDate(addDaysToKey(dayKey, 1)),
        },
      },
      select: {
        durationMinutes: true,
        caloriesBurned: true,
        category: true,
      },
    });

    const totalActiveCalories = Math.round(
      workouts.reduce((sum, w) => sum + (w.caloriesBurned || 0), 0),
    );
    const totalDurationMinutes = workouts.reduce(
      (sum, w) => sum + w.durationMinutes,
      0,
    );
    const workoutCount = workouts.length;
    const categories = Array.from(new Set(workouts.map((w) => w.category)));

    return {
      date: dayKey,
      totalActiveCalories,
      totalDurationMinutes,
      workoutCount,
      categories,
    };
  }

  /**
   * Tổng khối lượng tạ của buổi (Σ reps × tạ kg), chỉ set KHÔNG khởi động.
   */
  private calculateTotalVolume(exercises: any[]): number {
    if (!exercises || !exercises.length) return 0;
    let totalVolume = 0;
    for (const ex of exercises) {
      if (ex.sets && Array.isArray(ex.sets)) {
        for (const s of ex.sets) {
          if (s.isWarmup) continue;
          totalVolume += (s.weightKg || 0) * (s.reps || 0);
        }
      }
    }
    return Math.round(totalVolume * 10) / 10;
  }

  /** Ngày dạng khoá của một Date đã lưu (00:00 UTC). */
  protected dayKeyOf(d: Date): string {
    return dateToKey(d);
  }
}
