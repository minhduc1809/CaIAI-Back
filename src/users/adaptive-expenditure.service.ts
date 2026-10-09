import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  dateToKey,
  dayKeyOf,
  keyToDate,
  resolveTimezone,
} from '../common/utils/date-zone.util';
import {
  isCompleteDay,
  loadDayFlags,
} from '../common/utils/day-completeness.util';

export type ExpenditureMethod = 'ADAPTIVE' | 'STATIC_FALLBACK';
export type ExpenditureStatus =
  'STATIC' | 'LEARNING' | 'STABLE' | 'STALE' | 'UPDATING' | 'HOLDING';
export type ExpenditureConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AdaptiveExpenditureResult {
  method: ExpenditureMethod;
  status: ExpenditureStatus;
  confidence: ExpenditureConfidence;
  bandKcal: number;
  todoList: string[];
  estimatedExpenditure: number | null;
  staticTdee: number | null;
  windowDays: number;
  weightLogsCount: number;
  loggedDaysCount: number;
  trendWeightStart: number | null;
  trendWeightEnd: number | null;
  avgDailyCaloriesConsumed: number | null;
  message: string;
}

const KCAL_PER_KG = 7700;
const LOOKBACK_DAYS = 28;
const EWMA_ALPHA = 0.1;
const CONVERGENCE_ALPHA = 0.25;

// Điều kiện tối thiểu để tính Expenditure thích ứng (BR-05.4)
const MIN_WEIGHT_DAYS = 4;
const MIN_WINDOW_SPAN_DAYS = 10;
const MIN_LOGGED_DAYS = 5;

// Điều kiện trạng thái ổn định (BR-05.5)
const STABLE_MIN_SPAN_DAYS = 21;
const STABLE_MIN_LOGGED_DAYS = 10;
const STALE_AFTER_DAYS = 10;

// Chặn ước tính bất thường (nhiễu dữ liệu ngắn hạn) trong khoảng hợp lý quanh TDEE công thức tĩnh
const SANITY_MIN_RATIO = 0.6;
const SANITY_MAX_RATIO = 1.5;

/**
 * Adaptive Expenditure Engine — ước tính Energy Expenditure động dựa trên dữ liệu thực tế
 * (Trend Weight EWMA + calo đã log), thay vì chỉ dùng công thức tĩnh Mifflin/Katch-McArdle.
 */
@Injectable()
export class AdaptiveExpenditureService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính lại Expenditure thích ứng cho 1 user.
   */
  async recalculate(
    userId: string,
    staticTdee: number | null,
  ): Promise<AdaptiveExpenditureResult> {
    const tzUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, targetCalories: true },
    });
    const tz = resolveTimezone(tzUser?.timezone);

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    // Lấy toàn bộ cân nặng trong cửa sổ lookback
    const weightLogs = await this.prisma.weightLog.findMany({
      where: { userId, date: { gte: since } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    // 1. Nhóm cân nặng theo ngày (múi giờ user) và tính trung bình ngày (BR-09.4)
    const dayMap = new Map<string, { date: Date; weights: number[] }>();
    for (const log of weightLogs) {
      const key = dayKeyOf(log.date, tz);
      const cur = dayMap.get(key) ?? { date: log.date, weights: [] };
      cur.weights.push(log.weightKg);
      dayMap.set(key, cur);
    }

    const dayKeys = Array.from(dayMap.keys()).sort();
    const weightDays = dayKeys.map((k) => {
      const d = dayMap.get(k)!;
      const avg = d.weights.reduce((sum, w) => sum + w, 0) / d.weights.length;
      return {
        dateKey: k,
        date: keyToDate(k),
        avgWeight: avg,
        isOutlier: false,
        confirmed: false,
      };
    });

    // 2. Lọc ngoại lai (BR-05.3): lệch > max(2kg, 3%) mà không được xác nhận trong 3 ngày
    if (weightDays.length > 0) {
      let rTrend = weightDays[0].avgWeight;
      for (let i = 1; i < weightDays.length; i++) {
        const cur = weightDays[i];
        if (cur.confirmed) {
          rTrend = rTrend + EWMA_ALPHA * (cur.avgWeight - rTrend);
          continue;
        }

        const threshold = Math.max(2.0, rTrend * 0.03);
        if (Math.abs(cur.avgWeight - rTrend) > threshold) {
          let confirmed = false;
          for (let j = i + 1; j < weightDays.length; j++) {
            const next = weightDays[j];
            if (
              (next.date.getTime() - cur.date.getTime()) / (24 * 3600 * 1000) >
              3
            )
              break;
            if (Math.abs(next.avgWeight - cur.avgWeight) < 1.0) {
              confirmed = true;
              next.confirmed = true;
              break;
            }
          }
          if (confirmed) {
            cur.confirmed = true;
            rTrend = rTrend + EWMA_ALPHA * (cur.avgWeight - rTrend);
          } else {
            cur.isOutlier = true;
          }
        } else {
          rTrend = rTrend + EWMA_ALPHA * (cur.avgWeight - rTrend);
        }
      }
    }

    const validWeightDays = weightDays.filter((d) => !d.isOutlier);

    const fallback = (
      message: string,
      status: ExpenditureStatus = 'STATIC',
    ): AdaptiveExpenditureResult => ({
      method: 'STATIC_FALLBACK',
      status,
      confidence: 'LOW',
      bandKcal: 250,
      todoList: [
        validWeightDays.length < MIN_WEIGHT_DAYS
          ? `Cần cân thêm ít nhất ${MIN_WEIGHT_DAYS - validWeightDays.length} ngày nữa`
          : '',
      ].filter(Boolean),
      estimatedExpenditure: staticTdee,
      staticTdee,
      windowDays: 0,
      weightLogsCount: validWeightDays.length,
      loggedDaysCount: 0,
      trendWeightStart: null,
      trendWeightEnd: null,
      avgDailyCaloriesConsumed: null,
      message,
    });

    if (validWeightDays.length < MIN_WEIGHT_DAYS) {
      return fallback(
        `Cần cân thêm ít nhất ${MIN_WEIGHT_DAYS - validWeightDays.length} ngày nữa (trong ${LOOKBACK_DAYS} ngày gần đây) để bắt đầu tính Expenditure thích ứng. Hiện đang dùng công thức TDEE tĩnh.`,
        'STATIC',
      );
    }

    const firstWeight = validWeightDays[0];
    const lastWeight = validWeightDays[validWeightDays.length - 1];
    const windowDays = Math.max(
      1,
      Math.round(
        (lastWeight.date.getTime() - firstWeight.date.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    if (windowDays < MIN_WINDOW_SPAN_DAYS) {
      return fallback(
        `Cần theo dõi cân nặng trải dài ít nhất ${MIN_WINDOW_SPAN_DAYS} ngày (hiện tại ${windowDays} ngày). Hiện đang dùng công thức TDEE tĩnh.`,
        'STATIC',
      );
    }

    // Trend Weight (EWMA alpha=0.1) trên chuỗi ngày cân hợp lệ
    let trend = firstWeight.avgWeight;
    const residuals: number[] = [];
    for (let i = 1; i < validWeightDays.length; i++) {
      trend = trend + EWMA_ALPHA * (validWeightDays[i].avgWeight - trend);
      residuals.push(Math.abs(validWeightDays[i].avgWeight - trend));
    }
    const trendWeightStart = firstWeight.avgWeight;
    const trendWeightEnd = trend;

    // Calo đã log trong khoảng ngày của các lần cân, theo ngày của user
    const firstKey = firstWeight.dateKey;
    const lastKey = lastWeight.dateKey;
    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: { gte: keyToDate(firstKey), lte: keyToDate(lastKey) },
      },
      select: { logDate: true, totalCalories: true },
    });

    // Chỉ ngày ĐẦY ĐỦ mới được dùng (BR-05.2)
    const flags = await loadDayFlags(this.prisma, userId, firstKey, lastKey);
    const targetForRule = tzUser?.targetCalories ?? staticTdee ?? 2000;
    const perDay = new Map<string, { meals: number; calories: number }>();
    for (const meal of meals) {
      const key = dateToKey(meal.logDate);
      const cur = perDay.get(key) ?? { meals: 0, calories: 0 };
      cur.meals += 1;
      cur.calories += meal.totalCalories;
      perDay.set(key, cur);
    }
    const caloriesByDay = new Map<string, number>();
    for (const [key, d] of perDay) {
      if (isCompleteDay(d.meals, d.calories, targetForRule, flags.get(key))) {
        caloriesByDay.set(key, d.calories);
      }
    }
    const loggedDaysCount = caloriesByDay.size;

    if (loggedDaysCount < MIN_LOGGED_DAYS) {
      return fallback(
        `Cần log bữa ăn thêm ít nhất ${MIN_LOGGED_DAYS - loggedDaysCount} ngày nữa trong ${windowDays} ngày gần đây để bắt đầu tính Expenditure thích ứng. Hiện đang dùng công thức TDEE tĩnh.`,
        'STATIC',
      );
    }

    const totalCaloriesLogged = Array.from(caloriesByDay.values()).reduce(
      (sum, cal) => sum + cal,
      0,
    );
    const avgDailyCaloriesConsumed = totalCaloriesLogged / loggedDaysCount;

    // Phương trình cân bằng năng lượng
    const deltaWeightKg = trendWeightEnd - trendWeightStart;
    let rawExpenditure =
      avgDailyCaloriesConsumed - (deltaWeightKg * KCAL_PER_KG) / windowDays;

    // Sanity clamp quanh TDEE công thức tĩnh
    if (staticTdee) {
      const minBound = staticTdee * SANITY_MIN_RATIO;
      const maxBound = staticTdee * SANITY_MAX_RATIO;
      rawExpenditure = Math.min(Math.max(rawExpenditure, minBound), maxBound);
    }

    // Trộn dần với ước tính của ngày hôm trước (BR-05.9)
    const previousEstimate = await this.getPreviousDayEstimate(userId);
    const converged = previousEstimate
      ? previousEstimate +
        CONVERGENCE_ALPHA * (rawExpenditure - previousEstimate)
      : (rawExpenditure + (staticTdee ?? rawExpenditure)) / 2;

    // Xác định trạng thái mới (BR-05.5: STATIC, LEARNING, STABLE, STALE)
    const now = new Date();
    const daysSinceLastWeight = Math.round(
      (now.getTime() - lastWeight.date.getTime()) / (24 * 3600 * 1000),
    );

    let status: ExpenditureStatus;
    if (daysSinceLastWeight > STALE_AFTER_DAYS) {
      status = 'STALE';
    } else if (
      windowDays >= STABLE_MIN_SPAN_DAYS &&
      loggedDaysCount >= STABLE_MIN_LOGGED_DAYS
    ) {
      status = 'STABLE';
    } else {
      status = 'LEARNING';
    }

    // Tính độ tin cậy và dải sai số (BR-05.6)
    let confidence: ExpenditureConfidence = 'LOW';
    let bandKcal = 250;

    if (status === 'STABLE') {
      const meanRes =
        residuals.length > 0
          ? residuals.reduce((a, b) => a + b, 0) / residuals.length
          : 0;
      const sd =
        residuals.length > 0
          ? Math.sqrt(
              residuals.reduce((a, b) => a + Math.pow(b - meanRes, 2), 0) /
                residuals.length,
            )
          : 0;

      if (sd <= 0.8) {
        confidence = 'HIGH';
        bandKcal = 100;
      } else {
        confidence = 'MEDIUM';
        bandKcal = 150;
      }
    }

    const todoList: string[] = [];
    if (loggedDaysCount < STABLE_MIN_LOGGED_DAYS) {
      todoList.push(
        `Thêm ${STABLE_MIN_LOGGED_DAYS - loggedDaysCount} ngày ghi đủ bữa ăn`,
      );
    }
    if (windowDays < STABLE_MIN_SPAN_DAYS) {
      todoList.push(
        `Tiếp tục theo dõi cân nặng thêm ${STABLE_MIN_SPAN_DAYS - windowDays} ngày`,
      );
    }
    if (daysSinceLastWeight >= 5) {
      todoList.push('Hãy cân lại sớm để cập nhật mức tiêu hao');
    }

    return {
      method: 'ADAPTIVE',
      status,
      confidence,
      bandKcal,
      todoList,
      estimatedExpenditure: Math.round(converged),
      staticTdee,
      windowDays,
      weightLogsCount: validWeightDays.length,
      loggedDaysCount,
      trendWeightStart: Math.round(trendWeightStart * 10) / 10,
      trendWeightEnd: Math.round(trendWeightEnd * 10) / 10,
      avgDailyCaloriesConsumed: Math.round(avgDailyCaloriesConsumed),
      message:
        status === 'STABLE'
          ? 'Expenditure đã hội tụ ổn định dựa trên dữ liệu cân nặng và bữa ăn thực tế của bạn.'
          : status === 'STALE'
            ? 'Cân nặng đã quá 10 ngày chưa được cập nhật. Hãy cân lại để làm mới ước tính.'
            : 'Đang thu thập thêm dữ liệu thực tế để tinh chỉnh Expenditure — ước tính sẽ chính xác dần theo thời gian.',
    };
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private async getPreviousDayEstimate(userId: string): Promise<number | null> {
    const snapshot = await this.prisma.expenditureSnapshot.findFirst({
      where: {
        userId,
        recordedAt: { lt: this.startOfToday() },
        adaptiveExpenditure: { not: null },
      },
      orderBy: { recordedAt: 'desc' },
    });
    return snapshot?.adaptiveExpenditure ?? null;
  }

  /**
   * Ghi điểm lịch sử Expenditure với snapshotDate độc nhất mỗi ngày (BR-05.7).
   */
  async recordSnapshot(
    userId: string,
    result: Pick<
      AdaptiveExpenditureResult,
      'estimatedExpenditure' | 'staticTdee' | 'status'
    >,
  ): Promise<void> {
    const tzUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = resolveTimezone(tzUser?.timezone);
    const now = new Date();
    const snapshotDate = keyToDate(dayKeyOf(now, tz));

    const data = {
      adaptiveExpenditure: result.estimatedExpenditure,
      staticTdee: result.staticTdee,
      status: result.status,
      recordedAt: now,
    };

    // Upsert 1 bản ghi duy nhất mỗi ngày log
    await this.prisma.expenditureSnapshot.upsert({
      where: {
        userId_snapshotDate: {
          userId,
          snapshotDate,
        },
      },
      update: data,
      create: {
        userId,
        snapshotDate,
        ...data,
      },
    });
  }

  async getHistory(userId: string, limit = 60) {
    const snapshots = await this.prisma.expenditureSnapshot.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
    return snapshots.reverse();
  }
}
