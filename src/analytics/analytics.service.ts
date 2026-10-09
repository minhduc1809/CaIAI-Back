import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { InsightDto } from './dto/insight.dto';
import { isPremiumNow } from '../billing/entitlement.util';
import {
  addDaysToKey,
  dateToKey,
  diffDays,
  keyToDate,
  mondayOnOrBefore,
} from '../common/utils/date-zone.util';
import {
  isCompleteDay,
  loadDayFlags,
} from '../common/utils/day-completeness.util';

const PLATEAU_WEEKLY_RATIO = 0.0025; // 0.25% cân nặng / tuần
const PLATEAU_WEEKS = 3; // 3 tuần liên tiếp
const GOAL_DEVIATION_RATIO = 0.5; // lệch > 50% tốc độ mục tiêu
const GOAL_DEVIATION_WEEKS = 2; // 2 tuần liên tiếp
const MIN_COMPLETE_DAYS_PER_WEEK = 4; // mỗi tuần dùng để kết luận phải có >= 4 ngày ghi đầy đủ

interface WeekRate {
  /** Ngày thứ Hai của tuần kết thúc khoảng này (tuần mới hơn trong cặp). */
  weekStart: string;
  /** Thay đổi xu hướng cân nặng so với tuần liền trước (kg). */
  rate: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weightLogsService: WeightLogsService,
  ) {}

  /**
   * Insight tự động (BR-12): Plateau + Lệch mục tiêu. Chỉ mang tính thông tin, không tự đổi mục tiêu.
   *
   * Quy tắc chung: chỉ kết luận trên các tuần LIỀN NHAU (không nối qua tuần không có cân) và mỗi tuần phải có
   * ít nhất 4 ngày ghi đầy đủ, để không cảnh báo từ dữ liệu thưa. Free thấy 1 insight nổi bật đầy đủ, Premium thấy
   * tất cả (chỉ áp dụng khi BILLING_ENFORCE=true, giống các tính năng Premium khác).
   */
  async getInsights(
    userId: string,
  ): Promise<{ message: string; data: { insights: InsightDto[] } }> {
    const insights: InsightDto[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        weightKg: true,
        weightRateKgPerWeek: true,
        goal: true,
        programType: true,
        targetCalories: true,
      },
    });
    if (!user?.goal || !user.weightKg) {
      return { message: 'Lấy insight tự động thành công', data: { insights } };
    }

    const trendResult = await this.weightLogsService.getWeightTrend(userId, 90);
    const trendData = trendResult.data as {
      date: string;
      trendWeight: number;
    }[];
    const rates = this.trailingConsecutiveRates(trendData);

    const wantPlateau =
      user.goal !== 'MAINTAIN' && rates.length >= PLATEAU_WEEKS;
    const wantDeviation =
      user.goal !== 'MAINTAIN' && rates.length >= GOAL_DEVIATION_WEEKS;
    if (!wantPlateau && !wantDeviation) {
      return { message: 'Lấy insight tự động thành công', data: { insights } };
    }

    const completeDaysByWeek = await this.completeDaysByWeek(
      userId,
      rates.map((r) => r.weekStart),
      user.targetCalories ?? 0,
    );
    const enoughData = (list: WeekRate[]) =>
      list.every(
        (r) =>
          (completeDaysByWeek.get(r.weekStart) ?? 0) >=
          MIN_COMPLETE_DAYS_PER_WEEK,
      );

    // Plateau: 3 tuần liền nhau |Δ| < 0,25% cân nặng. Người đang Duy trì thì đi ngang là thành công nên bỏ qua.
    if (wantPlateau) {
      const lastN = rates.slice(-PLATEAU_WEEKS);
      const threshold = PLATEAU_WEEKLY_RATIO * user.weightKg;
      if (lastN.every((r) => Math.abs(r.rate) < threshold) && enoughData(lastN)) {
        insights.push({
          type: 'PLATEAU',
          title: 'Cân nặng đang đi ngang',
          message:
            user.programType === 'MANUAL'
              ? 'Xu hướng cân gần như không đổi trong 3 tuần qua dù bạn ghi bữa ăn đầy đủ. Bạn có thể xem lại mục tiêu calo trong phần Mục tiêu.'
              : 'Xu hướng cân gần như không đổi trong 3 tuần qua dù bạn ghi bữa ăn đầy đủ. Check-in tuần tới sẽ xem xét điều chỉnh.',
          locked: false,
        });
      }
    }

    // Lệch mục tiêu: 2 tuần liền nhau lệch > 50% so với tốc độ mục tiêu.
    if (wantDeviation) {
      const targetMagnitude = user.weightRateKgPerWeek ?? 0.5;
      const expectedRate =
        user.goal === 'LOSE_WEIGHT' ? -targetMagnitude : targetMagnitude;
      if (Math.abs(expectedRate) > 0.0001) {
        const lastN = rates.slice(-GOAL_DEVIATION_WEEKS);
        const deviating = lastN.every(
          (r) =>
            Math.abs(r.rate - expectedRate) / Math.abs(expectedRate) >
            GOAL_DEVIATION_RATIO,
        );
        if (deviating && enoughData(lastN)) {
          insights.push({
            type: 'GOAL_DEVIATION',
            title: 'Tốc độ thay đổi cân lệch so với mục tiêu',
            message:
              'Tốc độ thay đổi cân nặng 2 tuần qua lệch nhiều so với mục tiêu của bạn. Cân nhắc Check-in sớm hơn dự kiến.',
            locked: false,
          });
        }
      }
    }

    // Phân tầng: Free thấy MỘT insight nổi bật đầy đủ (insight ưu tiên cao nhất), các insight còn lại chỉ có tiêu đề;
    // Premium thấy tất cả. Free được "nếm" insight thật thay vì chỉ thấy màn khóa.
    if (
      insights.length > 1 &&
      process.env.BILLING_ENFORCE === 'true' &&
      !(await isPremiumNow(this.prisma, userId))
    ) {
      for (const insight of insights.slice(1)) {
        insight.message = '';
        insight.locked = true;
      }
    }

    return { message: 'Lấy insight tự động thành công', data: { insights } };
  }

  /**
   * Xu hướng cân cuối mỗi tuần (tuần bắt đầu thứ Hai), rồi lấy chuỗi thay đổi theo tuần của đoạn LIÊN TIẾP
   * mới nhất. Tuần thiếu dữ liệu cắt đứt chuỗi; không nối hai tuần cách nhau rồi coi như thay đổi trong một tuần.
   */
  private trailingConsecutiveRates(
    trendData: { date: string; trendWeight: number }[],
  ): WeekRate[] {
    const byWeek = new Map<string, number>();
    for (const point of trendData) {
      byWeek.set(mondayOnOrBefore(point.date), point.trendWeight);
    }
    const weeks = [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

    const rates: WeekRate[] = [];
    for (let i = 1; i < weeks.length; i++) {
      const [weekStart, weight] = weeks[i];
      const [prevStart, prevWeight] = weeks[i - 1];
      if (diffDays(prevStart, weekStart) === 7) {
        rates.push({ weekStart, rate: weight - prevWeight });
      } else {
        rates.length = 0; // chuỗi bị đứt: bắt đầu lại từ tuần này
      }
    }
    return rates;
  }

  /** Số ngày ghi đầy đủ trong từng tuần (khoá = ngày thứ Hai). */
  private async completeDaysByWeek(
    userId: string,
    weekStarts: string[],
    targetCalories: number,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (weekStarts.length === 0) return result;
    const sorted = [...weekStarts].sort();
    const startKey = sorted[0];
    const endKey = addDaysToKey(sorted[sorted.length - 1], 6);

    const [meals, flags] = await Promise.all([
      this.prisma.meal.findMany({
        where: {
          userId,
          logDate: { gte: keyToDate(startKey), lte: keyToDate(endKey) },
        },
        select: { logDate: true, totalCalories: true },
      }),
      loadDayFlags(this.prisma, userId, startKey, endKey),
    ]);

    const byDay = new Map<string, { meals: number; calories: number }>();
    for (const meal of meals) {
      const key = dateToKey(meal.logDate);
      const cur = byDay.get(key) ?? { meals: 0, calories: 0 };
      cur.meals += 1;
      cur.calories += meal.totalCalories;
      byDay.set(key, cur);
    }
    for (const [key, day] of byDay) {
      if (isCompleteDay(day.meals, day.calories, targetCalories, flags.get(key))) {
        const week = mondayOnOrBefore(key);
        result.set(week, (result.get(week) ?? 0) + 1);
      }
    }
    return result;
  }
}
