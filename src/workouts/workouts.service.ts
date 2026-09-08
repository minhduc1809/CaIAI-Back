import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { UpdateWorkoutLogDto } from './dto/update-workout-log.dto';
import { QueryWorkoutDto } from './dto/query-workout.dto';
import { WorkoutCategory } from '@prisma/client';

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

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính toán năng lượng tiêu hao chuẩn theo hệ số MET và cân nặng người dùng
   * Công thức: Calo = MET * weightKg * (durationMinutes / 60)
   */
  calculateCalories(
    category: WorkoutCategory,
    durationMinutes: number,
    userWeightKg: number,
  ): number {
    const met = MET_TABLE[category]?.met || 4.0;
    const calories = met * userWeightKg * (durationMinutes / 60);
    return Math.round(calories * 10) / 10;
  }

  /**
   * Lấy danh sách các loại bài tập kèm thông số MET để hiển thị trên UI
   */
  getCategories() {
    return Object.entries(MET_TABLE).map(([category, config]) => ({
      category: category as WorkoutCategory,
      nameVi: config.nameVi,
      met: config.met,
      description: config.description,
    }));
  }

  /**
   * Ghi nhận một buổi tập mới
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
    } = dto;

    // 1. Lấy thông tin cân nặng của user để tự động tính calo nếu không nhập
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { weightKg: true },
    });

    const weightKg = user?.weightKg || 65; // Mặc định 65kg nếu chưa cập nhật hồ sơ
    const finalCalories =
      caloriesBurned !== undefined && caloriesBurned !== null
        ? caloriesBurned
        : this.calculateCalories(category, durationMinutes, weightKg);

    const workoutDate = date ? new Date(date) : new Date();

    // 2. Tạo bản ghi WorkoutLog kèm Exercises và Sets
    const workout = await this.prisma.workoutLog.create({
      data: {
        userId,
        name,
        category,
        date: workoutDate,
        durationMinutes,
        caloriesBurned: finalCalories,
        rpe: rpe || null,
        note: note || null,
        exercises: exercises?.length
          ? {
              create: exercises.map((ex, idx) => ({
                name: ex.name,
                order: ex.order !== undefined ? ex.order : idx,
                sets: {
                  create: ex.sets.map((s) => ({
                    setNumber: s.setNumber,
                    reps: s.reps,
                    weightKg: s.weightKg,
                    rpe: s.rpe || null,
                  })),
                },
              })),
            }
          : undefined,
      },
      include: {
        exercises: {
          include: {
            sets: {
              orderBy: { setNumber: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    // 3. Tính toán Volume Load tổng cộng
    const totalVolumeKg = this.calculateTotalVolume(workout.exercises);

    return {
      ...workout,
      totalVolumeKg,
    };
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

    if (date) {
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      where.date = { gte: startOfDay, lte: endOfDay };
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        where.date.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const workouts = await this.prisma.workoutLog.findMany({
      where,
      include: {
        exercises: {
          include: {
            sets: {
              orderBy: { setNumber: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
    });

    return workouts.map((w) => ({
      ...w,
      totalVolumeKg: this.calculateTotalVolume(w.exercises),
    }));
  }

  /**
   * Lấy chi tiết một buổi tập
   */
  async getWorkoutById(userId: string, id: string) {
    const workout = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
      include: {
        exercises: {
          include: {
            sets: {
              orderBy: { setNumber: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!workout) {
      throw new NotFoundException(
        'Không tìm thấy buổi tập hoặc bạn không có quyền truy cập',
      );
    }

    return {
      ...workout,
      totalVolumeKg: this.calculateTotalVolume(workout.exercises),
    };
  }

  /**
   * Cập nhật buổi tập
   */
  async updateWorkout(userId: string, id: string, dto: UpdateWorkoutLogDto) {
    const existing = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy buổi tập để cập nhật');
    }

    const { name, category, date, durationMinutes, caloriesBurned, rpe, note } =
      dto;

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

    const updated = await this.prisma.workoutLog.update({
      where: { id },
      data: {
        name: name || undefined,
        category: category || undefined,
        date: date ? new Date(date) : undefined,
        durationMinutes: durationMinutes || undefined,
        caloriesBurned: finalCalories,
        rpe: rpe !== undefined ? rpe : undefined,
        note: note !== undefined ? note : undefined,
      },
      include: {
        exercises: {
          include: {
            sets: {
              orderBy: { setNumber: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return {
      ...updated,
      totalVolumeKg: this.calculateTotalVolume(updated.exercises),
    };
  }

  /**
   * Xóa buổi tập
   */
  async deleteWorkout(userId: string, id: string) {
    const existing = await this.prisma.workoutLog.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy buổi tập để xóa');
    }

    await this.prisma.workoutLog.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Đã xóa buổi tập thành công',
    };
  }

  /**
   * Tổng hợp hoạt động thể chất trong ngày (Active Calories, thời lượng, số buổi)
   */
  async getDailySummary(userId: string, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const workouts = await this.prisma.workoutLog.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
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
      date: targetDate.toISOString().split('T')[0],
      totalActiveCalories,
      totalDurationMinutes,
      workoutCount,
      categories,
    };
  }

  /**
   * Tính tổng khối lượng tạ (Volume load = sum(reps * weightKg))
   */
  private calculateTotalVolume(exercises: any[]): number {
    if (!exercises || !exercises.length) return 0;
    let totalVolume = 0;
    for (const ex of exercises) {
      if (ex.sets && Array.isArray(ex.sets)) {
        for (const s of ex.sets) {
          totalVolume += (s.weightKg || 0) * (s.reps || 0);
        }
      }
    }
    return Math.round(totalVolume * 10) / 10;
  }
}
