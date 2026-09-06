import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ExpenditureMethod = 'ADAPTIVE' | 'STATIC_FALLBACK';
export type ExpenditureStatus = 'UPDATING' | 'HOLDING';

export interface AdaptiveExpenditureResult {
  method: ExpenditureMethod;
  status: ExpenditureStatus;
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

const MIN_WEIGHT_LOGS = 4;
const MIN_WINDOW_SPAN_DAYS = 7;
const MIN_LOGGED_DAYS = 5;

const HOLDING_MIN_SPAN_DAYS = 14;
const HOLDING_MIN_LOGGED_DAYS = 8;

// Chặn ước tính bất thường (nhiễu dữ liệu ngắn hạn) trong khoảng hợp lý quanh TDEE công thức tĩnh
const SANITY_MIN_RATIO = 0.6;
const SANITY_MAX_RATIO = 1.5;

/**
 * Adaptive Expenditure Engine — ước tính Energy Expenditure động dựa trên dữ liệu thực tế
 * (Trend Weight EWMA + calo đã log), thay vì chỉ dùng công thức tĩnh Mifflin/Katch-McArdle.
 *
 * Nguyên lý (Energy Balance Equation): trong 1 khoảng thời gian,
 *   ΔTrendWeight(kg) * 7700 kcal/kg = (Calo nạp trung bình/ngày - Expenditure thực tế/ngày) * số ngày
 * => Expenditure = Calo nạp trung bình/ngày - (ΔTrendWeight * 7700) / số ngày
 *
 * "Adherence-Neutral": không phạt/thưởng người dùng vì log thiếu ngày — chỉ cần đủ dữ liệu tối thiểu
 * là tính được, bất kể có log đều 100% hay không.
 * "Hội tụ theo thời gian": ước tính mới được trộn dần với ước tính trước đó (không nhảy đột ngột).
 */
@Injectable()
export class AdaptiveExpenditureService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tính lại Expenditure thích ứng cho 1 user. Không tự lưu — nơi gọi (WeightLogsService,
   * UsersService) chịu trách nhiệm persist kết quả vào User và dùng để tính lại Target Calories.
   */
  async recalculate(userId: string, staticTdee: number | null, previousEstimate: number | null): Promise<AdaptiveExpenditureResult> {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const weightLogs = await this.prisma.weightLog.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    const fallback = (message: string): AdaptiveExpenditureResult => ({
      method: 'STATIC_FALLBACK',
      status: 'UPDATING',
      estimatedExpenditure: staticTdee,
      staticTdee,
      windowDays: 0,
      weightLogsCount: weightLogs.length,
      loggedDaysCount: 0,
      trendWeightStart: null,
      trendWeightEnd: null,
      avgDailyCaloriesConsumed: null,
      message,
    });

    if (weightLogs.length < MIN_WEIGHT_LOGS) {
      return fallback(
        `Cần cân thêm ít nhất ${MIN_WEIGHT_LOGS - weightLogs.length} lần nữa (trong ${LOOKBACK_DAYS} ngày gần đây) để bắt đầu tính Expenditure thích ứng. Hiện đang dùng công thức TDEE tĩnh.`,
      );
    }

    const firstLog = weightLogs[0];
    const lastLog = weightLogs[weightLogs.length - 1];
    const windowDays = Math.max(
      1,
      Math.round((lastLog.date.getTime() - firstLog.date.getTime()) / (1000 * 60 * 60 * 24)),
    );

    if (windowDays < MIN_WINDOW_SPAN_DAYS) {
      return fallback(
        `Cần theo dõi cân nặng trải dài ít nhất ${MIN_WINDOW_SPAN_DAYS} ngày (hiện tại ${windowDays} ngày). Hiện đang dùng công thức TDEE tĩnh.`,
      );
    }

    // Trend Weight (EWMA alpha=0.1) — cùng công thức với WeightLogsService.getWeightTrend
    let trend = firstLog.weightKg;
    for (let i = 1; i < weightLogs.length; i++) {
      trend = trend + EWMA_ALPHA * (weightLogs[i].weightKg - trend);
    }
    const trendWeightStart = firstLog.weightKg;
    const trendWeightEnd = trend;

    // Calo đã log trong đúng khoảng ngày của các lần cân [firstLog.date, lastLog.date]
    const meals = await this.prisma.meal.findMany({
      where: { userId, date: { gte: firstLog.date, lte: lastLog.date } },
      select: { date: true, totalCalories: true },
    });

    const caloriesByDay = new Map<string, number>();
    for (const meal of meals) {
      const key = meal.date.toISOString().split('T')[0];
      caloriesByDay.set(key, (caloriesByDay.get(key) || 0) + meal.totalCalories);
    }
    const loggedDaysCount = caloriesByDay.size;

    if (loggedDaysCount < MIN_LOGGED_DAYS) {
      return fallback(
        `Cần log bữa ăn thêm ít nhất ${MIN_LOGGED_DAYS - loggedDaysCount} ngày nữa trong ${windowDays} ngày gần đây để bắt đầu tính Expenditure thích ứng. Hiện đang dùng công thức TDEE tĩnh.`,
      );
    }

    const totalCaloriesLogged = Array.from(caloriesByDay.values()).reduce((sum, cal) => sum + cal, 0);
    const avgDailyCaloriesConsumed = totalCaloriesLogged / loggedDaysCount;

    // Phương trình cân bằng năng lượng
    const deltaWeightKg = trendWeightEnd - trendWeightStart;
    let rawExpenditure = avgDailyCaloriesConsumed - (deltaWeightKg * KCAL_PER_KG) / windowDays;

    // Sanity clamp quanh TDEE công thức tĩnh (nếu có) để tránh ước tính phi thực tế từ dữ liệu ngắn/nhiễu
    if (staticTdee) {
      const minBound = staticTdee * SANITY_MIN_RATIO;
      const maxBound = staticTdee * SANITY_MAX_RATIO;
      rawExpenditure = Math.min(Math.max(rawExpenditure, minBound), maxBound);
    }

    // Hội tụ dần theo thời gian: trộn với ước tính trước đó thay vì nhảy đột ngột mỗi lần tính lại
    const converged = previousEstimate
      ? previousEstimate + CONVERGENCE_ALPHA * (rawExpenditure - previousEstimate)
      : (rawExpenditure + (staticTdee ?? rawExpenditure)) / 2;

    const status: ExpenditureStatus =
      windowDays >= HOLDING_MIN_SPAN_DAYS && loggedDaysCount >= HOLDING_MIN_LOGGED_DAYS ? 'HOLDING' : 'UPDATING';

    return {
      method: 'ADAPTIVE',
      status,
      estimatedExpenditure: Math.round(converged),
      staticTdee,
      windowDays,
      weightLogsCount: weightLogs.length,
      loggedDaysCount,
      trendWeightStart: Math.round(trendWeightStart * 10) / 10,
      trendWeightEnd: Math.round(trendWeightEnd * 10) / 10,
      avgDailyCaloriesConsumed: Math.round(avgDailyCaloriesConsumed),
      message:
        status === 'HOLDING'
          ? 'Expenditure đã hội tụ ổn định dựa trên dữ liệu cân nặng và bữa ăn thực tế của bạn.'
          : 'Đang thu thập thêm dữ liệu thực tế để tinh chỉnh Expenditure — ước tính sẽ chính xác dần theo thời gian.',
    };
  }
}
