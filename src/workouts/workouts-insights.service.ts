import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToKey,
  dateToKey,
  keyToDate,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import { isNotificationDisabled } from '../users/user-settings';
import { exerciseKey, setVolume } from './workout-records';
import { activityBucket, mondayKeyOf } from './workout-rules';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_WEEKS = 26;
/** Số tuần gần nhất dùng để đối chiếu số buổi tập thực tế (`workout.activityMismatchWindowWeeks`). */
export const ACTIVITY_WINDOW_WEEKS = 4;
/** Số tuần lệch nhóm tối thiểu để đề xuất (`workout.activityMismatchWeeks`). */
export const ACTIVITY_MISMATCH_WEEKS = 3;
const RECHECK_DAYS_MANUAL = 28;
const RECHECK_DAYS_COACHED = 7;

type SetRow = { reps: number; weightKg: number; isWarmup: boolean; setNumber: number };

/** Lịch sử, thống kê và đối chiếu số buổi tập thực tế (BR-10.7, BR-10.8). Chỉ đọc, trừ việc ghi nhận "đã xử lý". */
@Injectable()
export class WorkoutsInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  private async tz(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    return resolveTimezone(u?.timezone);
  }

  /** Điền khoá cho bài cũ (ghi trước khi có `exerciseKey`) rồi dùng khoá để truy vấn. */
  private async backfill(userId: string) {
    const legacy = await this.prisma.workoutExercise.findMany({
      where: { exerciseKey: null, workoutLog: { userId } },
      select: { id: true, name: true, exerciseSource: true, exerciseRefId: true },
    });
    for (const ex of legacy) {
      await this.prisma.workoutExercise.update({ where: { id: ex.id }, data: { exerciseKey: exerciseKey(ex) } });
    }
  }

  /** Lịch tháng: các ngày có tập và danh sách buổi tập trong tháng (`GET workouts/history?month=YYYY-MM`). */
  async history(userId: string, month?: string) {
    const tz = await this.tz(userId);
    let year: number;
    let monthIndex: number;
    if (month) {
      const m = MONTH_RE.exec(month);
      if (!m) throw new BadRequestException('Tháng phải có dạng YYYY-MM, ví dụ 2026-10');
      year = Number(m[1]);
      monthIndex = Number(m[2]) - 1;
    } else {
      const [y, mo] = todayKey(tz).split('-').map(Number);
      year = y;
      monthIndex = mo - 1;
    }
    const from = new Date(Date.UTC(year, monthIndex, 1));
    const to = new Date(Date.UTC(year, monthIndex + 1, 1));
    const sessions = await this.prisma.workoutLog.findMany({
      where: { userId, date: { gte: from, lt: to } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { exercises: { include: { sets: true } } },
    });
    const days = new Map<string, { date: string; sessions: number; minutes: number; calories: number }>();
    for (const s of sessions) {
      const key = dateToKey(s.date);
      const d = days.get(key) ?? { date: key, sessions: 0, minutes: 0, calories: 0 };
      d.sessions += 1;
      d.minutes += s.durationMinutes;
      d.calories += s.caloriesBurned;
      days.set(key, d);
    }
    return {
      month: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      days: [...days.values()].map((d) => ({ ...d, calories: Math.round(d.calories) })),
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        date: dateToKey(s.date),
        durationMinutes: s.durationMinutes,
        caloriesBurned: s.caloriesBurned,
        exerciseCount: s.exercises.length,
        setCount: s.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.isWarmup).length, 0),
      })),
    };
  }

  /** Các lần tập một bài: ngày, set tốt nhất, volume (BR-10.8). `key` là khoá bài, ví dụ "CATALOG:m-beg-01". */
  async exerciseHistory(userId: string, key: string) {
    if (!key) throw new BadRequestException('Thiếu key của bài tập');
    if (key.startsWith('name:')) await this.backfill(userId);
    const rows = await this.prisma.workoutExercise.findMany({
      where: { exerciseKey: key, workoutLog: { userId } },
      include: { sets: { orderBy: { setNumber: 'asc' } }, workoutLog: { select: { id: true, date: true, name: true } } },
      orderBy: { workoutLog: { date: 'desc' } },
      take: 50,
    });
    return {
      key,
      items: rows.map((r) => {
        const work = r.sets.filter((s) => !s.isWarmup);
        const best = [...work].sort((a, b) => b.weightKg - a.weightKg || b.reps - a.reps)[0] ?? null;
        return {
          workoutId: r.workoutLog.id,
          workoutName: r.workoutLog.name,
          date: dateToKey(r.workoutLog.date),
          bestSet: best ? { weightKg: best.weightKg, reps: best.reps } : null,
          workingSets: work.length,
          volume: Math.round(work.reduce((a, s) => a + setVolume(s.weightKg, s.reps), 0) * 100) / 100,
        };
      }),
    };
  }

  /** Các set của lần tập gần nhất của bài, để app điền sẵn số lần và tạ của set tương ứng (BR-10.4). */
  async lastSets(userId: string, key: string): Promise<{ key: string; date: string | null; sets: SetRow[] }> {
    if (!key) throw new BadRequestException('Thiếu key của bài tập');
    if (key.startsWith('name:')) await this.backfill(userId);
    const row = await this.prisma.workoutExercise.findFirst({
      where: { exerciseKey: key, workoutLog: { userId } },
      include: { sets: { orderBy: { setNumber: 'asc' } }, workoutLog: { select: { date: true } } },
      orderBy: { workoutLog: { date: 'desc' } },
    });
    if (!row) return { key, date: null, sets: [] };
    return {
      key,
      date: dateToKey(row.workoutLog.date),
      sets: row.sets.map((s) => ({ setNumber: s.setNumber, reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup })),
    };
  }

  /** Volume theo tuần, lọc theo bài hoặc nhóm cơ chính (`workouts/stats/volume`). Set khởi động không tính. */
  async volumeByWeek(userId: string, params: { weeks?: number; key?: string; muscle?: string }) {
    const weeks = Math.min(MAX_WEEKS, Math.max(1, Math.floor(Number(params.weeks)) || 8));
    const tz = await this.tz(userId);
    const thisMonday = mondayKeyOf(todayKey(tz));
    const firstMonday = addDaysToKey(thisMonday, -7 * (weeks - 1));
    const rows = await this.prisma.workoutExercise.findMany({
      where: {
        workoutLog: { userId, date: { gte: keyToDate(firstMonday), lt: keyToDate(addDaysToKey(thisMonday, 7)) } },
        ...(params.key ? { exerciseKey: params.key } : {}),
        ...(params.muscle ? { primaryMuscle: params.muscle } : {}),
      },
      include: { sets: true, workoutLog: { select: { date: true } } },
    });
    const buckets = new Map<string, { weekStart: string; volume: number; sets: number }>();
    for (let i = 0; i < weeks; i++) {
      const k = addDaysToKey(firstMonday, 7 * i);
      buckets.set(k, { weekStart: k, volume: 0, sets: 0 });
    }
    for (const r of rows) {
      const b = buckets.get(mondayKeyOf(dateToKey(r.workoutLog.date)));
      if (!b) continue;
      for (const s of r.sets) {
        if (s.isWarmup) continue;
        b.volume += setVolume(s.weightKg, s.reps);
        b.sets += 1;
      }
    }
    return { weeks, items: [...buckets.values()].map((b) => ({ ...b, volume: Math.round(b.volume * 100) / 100 })) };
  }

  /** Số set (không khởi động) theo nhóm cơ chính trong N tuần gần nhất (`workouts/stats/sets`). */
  async setsPerMuscle(userId: string, weeksRaw?: number) {
    const weeks = Math.min(MAX_WEEKS, Math.max(1, Math.floor(Number(weeksRaw)) || 1));
    const tz = await this.tz(userId);
    const thisMonday = mondayKeyOf(todayKey(tz));
    const firstMonday = addDaysToKey(thisMonday, -7 * (weeks - 1));
    const rows = await this.prisma.workoutExercise.findMany({
      where: { workoutLog: { userId, date: { gte: keyToDate(firstMonday), lt: keyToDate(addDaysToKey(thisMonday, 7)) } } },
      include: { sets: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const muscle = r.primaryMuscle || 'Khác';
      const n = r.sets.filter((s) => !s.isWarmup).length;
      if (n > 0) counts.set(muscle, (counts.get(muscle) ?? 0) + n);
    }
    return {
      weeks,
      items: [...counts.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets),
    };
  }

  /** Kỷ lục cá nhân đang lưu, gom theo bài (`workouts/records`). */
  async records(userId: string, key?: string) {
    const rows = await this.prisma.personalRecord.findMany({
      where: { userId, ...(key ? { exerciseKey: key } : {}) },
      orderBy: [{ exerciseName: 'asc' }, { type: 'asc' }, { weightKey: 'asc' }],
    });
    const byExercise = new Map<string, { exerciseKey: string; exerciseName: string; records: any[] }>();
    for (const r of rows) {
      const g = byExercise.get(r.exerciseKey) ?? { exerciseKey: r.exerciseKey, exerciseName: r.exerciseName, records: [] };
      g.records.push({
        type: r.type,
        value: r.value,
        reps: r.reps,
        weightKg: r.weightKg,
        workoutId: r.workoutId,
        achievedAt: dateToKey(r.achievedAt),
      });
      byExercise.set(r.exerciseKey, g);
    }
    return { items: [...byExercise.values()] };
  }

  /** Buổi tập gần nhất dưới dạng khuôn để "Lặp lại buổi gần nhất" (BR-10.6): cùng bài, số liệu điền sẵn. */
  async lastWorkoutTemplate(userId: string) {
    const w = await this.prisma.workoutLog.findFirst({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { exercises: { include: { sets: { orderBy: { setNumber: 'asc' } } }, orderBy: { order: 'asc' } } },
    });
    if (!w) return { template: null };
    return {
      template: {
        name: w.name,
        category: w.category,
        durationMinutes: w.durationMinutes,
        exercises: w.exercises.map((e) => ({
          name: e.name,
          exerciseSource: e.exerciseSource,
          exerciseId: e.exerciseRefId,
          primaryMuscle: e.primaryMuscle,
          restSec: e.restSec,
          sets: e.sets.map((s) => ({ setNumber: s.setNumber, reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup })),
        })),
      },
    };
  }

  /**
   * Đối chiếu số buổi tập thực tế với khai báo (BR-10.7). Lấy 4 tuần ĐẦY ĐỦ gần nhất (Thứ Hai–Chủ Nhật) nằm trọn
   * trong thời gian có tài khoản. Nếu ít nhất 3/4 tuần rơi vào nhóm hệ số vận động KHÁC với nhóm đã khai báo (bảng
   * BR-03.2: 0 / 1–2 / 3–4 / 5–6 / 7) thì đề xuất cập nhật `trainingDaysPerWeek`. Chỉ đề xuất, không tự đổi.
   */
  async activityCheck(userId: string, now: Date = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        trainingDaysPerWeek: true,
        programType: true,
        createdAt: true,
        timezone: true,
        expenditureStatus: true,
        activityCheckAt: true,
      },
    });
    if (!user) throw new BadRequestException('Không tìm thấy người dùng');
    const declared = user.trainingDaysPerWeek;
    if (declared === null || declared === undefined) {
      return { eligible: false, reason: 'NO_DECLARED_DAYS' as const };
    }

    // Tần suất: người tự quản (MANUAL) mỗi 4 tuần, người có huấn luyện mỗi tuần (theo Check-in)
    const recheckDays = user.programType === 'MANUAL' ? RECHECK_DAYS_MANUAL : RECHECK_DAYS_COACHED;
    if (user.activityCheckAt && now.getTime() - user.activityCheckAt.getTime() < recheckDays * 86_400_000) {
      return { eligible: false, reason: 'RECENTLY_HANDLED' as const };
    }

    const tz = resolveTimezone(user.timezone);
    const thisMonday = mondayKeyOf(todayKey(tz, now));
    const firstMonday = addDaysToKey(thisMonday, -7 * ACTIVITY_WINDOW_WEEKS);
    const createdKey = dateToKey(new Date(user.createdAt.toLocaleDateString('en-CA', { timeZone: tz }) + 'T00:00:00Z'));
    if (firstMonday < mondayKeyOf(createdKey)) {
      return { eligible: false, reason: 'NOT_ENOUGH_HISTORY' as const };
    }

    const sessions = await this.prisma.workoutLog.findMany({
      where: { userId, date: { gte: keyToDate(firstMonday), lt: keyToDate(thisMonday) } },
      select: { date: true },
    });
    const perWeek = Array.from({ length: ACTIVITY_WINDOW_WEEKS }, () => 0);
    for (const s of sessions) {
      const idx = Math.floor((keyToDate(mondayKeyOf(dateToKey(s.date))).getTime() - keyToDate(firstMonday).getTime()) / (7 * 86_400_000));
      if (idx >= 0 && idx < ACTIVITY_WINDOW_WEEKS) perWeek[idx] += 1;
    }
    const declaredBucket = activityBucket(declared);
    const mismatchWeeks = perWeek.filter((n) => activityBucket(n) !== declaredBucket).length;
    const average = Math.round((perWeek.reduce((a, b) => a + b, 0) / ACTIVITY_WINDOW_WEEKS) * 10) / 10;
    if (mismatchWeeks < ACTIVITY_MISMATCH_WEEKS) {
      return { eligible: true, mismatch: false, declaredDays: declared, averagePerWeek: average, weeklyCounts: perWeek };
    }
    const suggested = Math.min(7, Math.max(0, Math.round(average)));
    return {
      eligible: true,
      mismatch: true,
      declaredDays: declared,
      averagePerWeek: average,
      weeklyCounts: perWeek,
      suggestedTrainingDays: suggested,
      message: `Bạn đang tập trung bình ${average} buổi/tuần, khác với ${declared} buổi/tuần đã khai báo. Cập nhật hồ sơ?`,
      note:
        user.expenditureStatus === 'STABLE'
          ? 'Mục tiêu của bạn đã được điều chỉnh theo dữ liệu thật; thay đổi này chủ yếu ảnh hưởng ước tính ban đầu.'
          : null,
    };
  }

  /**
   * Nhắc "Bạn vừa tập?" khi có dấu hiệu quên ghi buổi tập. Chỉ nhắc người đang tập đều: trong 14 ngày qua có ít nhất
   * 3 ngày có buổi tập, hôm nay chưa ghi buổi nào và đã im lặng lâu hơn khoảng cách trung bình giữa các buổi
   * (tối thiểu 2 ngày). Chỉ gợi ý, không tự ghi gì.
   */
  async logNudge(userId: string, now: Date = new Date()) {
    const tz = await this.tz(userId);
    const today = todayKey(tz, now);
    const rows = await this.prisma.workoutLog.findMany({
      where: { userId, date: { gte: keyToDate(addDaysToKey(today, -14)), lte: keyToDate(today) } },
      orderBy: { date: 'desc' },
      select: { id: true, name: true, date: true },
    });
    const keys = [...new Set(rows.map((r) => dateToKey(r.date)))].sort();
    if (keys.includes(today)) return { show: false, reason: 'LOGGED_TODAY' as const };
    if (keys.length < 3) return { show: false, reason: 'NOT_ENOUGH_HISTORY' as const };

    const dayDiff = (a: string, b: string) => Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / 86_400_000);
    const lastKey = keys[keys.length - 1];
    const averageGapDays = Math.round((dayDiff(keys[0], lastKey) / (keys.length - 1)) * 10) / 10;
    const daysSinceLast = dayDiff(lastKey, today);
    if (daysSinceLast < Math.max(2, Math.ceil(averageGapDays))) return { show: false, reason: 'NOT_OVERDUE' as const };

    const last = rows.find((r) => dateToKey(r.date) === lastKey)!;
    const message = `Bạn thường tập khoảng ${averageGapDays} ngày một buổi nhưng đã ${daysSinceLast} ngày chưa ghi buổi nào (gần nhất: ${last.name}). Bạn vừa tập xong? Ghi nhanh kẻo quên!`;

    // Đẩy vào hộp thông báo (không hiện thẻ trên Trang chủ): tối đa 1 lần mỗi ngày, tôn trọng cài đặt tắt loại này
    let notified = false;
    const prefs = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    if (!isNotificationDisabled(prefs?.notificationPrefs, 'WORKOUT_REMINDER')) {
      const recent = await this.prisma.notification.findFirst({
        where: { userId, type: 'WORKOUT_REMINDER', createdAt: { gte: new Date(now.getTime() - 20 * 3_600_000) } },
        select: { id: true },
      });
      if (!recent) {
        await this.prisma.notification.create({
          data: { userId, type: 'WORKOUT_REMINDER', title: 'Bạn vừa tập xong?', message },
        });
        notified = true;
      }
    }
    return {
      show: true,
      notified,
      daysSinceLast,
      averageGapDays,
      lastWorkout: { id: last.id, name: last.name, date: lastKey },
      message,
    };
  }

  /** Người dùng đã xem đề xuất (đồng ý hoặc bỏ qua): ghi nhận để không hỏi lại ngay. */
  async markActivityCheckHandled(userId: string, now: Date = new Date()) {
    await this.prisma.user.update({ where: { id: userId }, data: { activityCheckAt: now } });
    return { success: true };
  }
}
