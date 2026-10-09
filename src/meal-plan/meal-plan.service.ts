import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';
import { getAllowedFoods } from '../recommendations/food-safety';
import { isFreeTierLimited } from '../billing/entitlement.util';
import {
  addDaysToKey,
  diffDays,
  keyToDate,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import {
  MealSlot,
  isLimitedChoice,
  PlanFood,
  DayPlan,
  PlanSlot,
  buildDayPlan,
  slotBudgetsFor,
} from './planner';

/** Free xem trước bao nhiêu ngày đầu của kế hoạch 30 ngày (đặc tả 1.9). */
export const FREE_PREVIEW_DAYS = 7;
/** Tránh lặp món so với bấy nhiêu ngày liền trước (đặc tả 1.8). */
const AVOID_REPEAT_DAYS = 2;
/** Bữa đã ăn từ ngưỡng này của ngân sách thì coi như đã xong. */
const SLOT_DONE_RATIO = 0.8;
/** Dưới mức này của phần còn lại thì không đề xuất thêm. */
const MIN_REMAINING_TO_SUGGEST = 80;

const LIMITED_MESSAGE =
  'Số món phù hợp với dị ứng và chế độ ăn của bạn đang khá hạn chế nên thực đơn có thể lặp lại. Bạn có thể xem lại phần dị ứng hoặc chế độ ăn trong hồ sơ nếu muốn mở rộng lựa chọn.';

interface PlanUser {
  targetCalories: number;
  targetProtein: number | null;
  targetCarb: number | null;
  targetFat: number | null;
  macroStyle: string | null;
  goal: string | null;
  mealsPerDay: number | null;
  dietType: string | null;
  allergies: string[];
  timezone: string;
}

@Injectable()
export class MealPlanService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadUser(userId: string): Promise<PlanUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        macroStyle: true,
        goal: true,
        mealsPerDay: true,
        dietType: true,
        allergies: true,
        timezone: true,
      },
    });
    // Thực đơn bám mục tiêu thật; không bịa mục tiêu mặc định
    if (!user?.targetCalories) throw new ProfileIncompleteException();
    return {
      targetCalories: user.targetCalories,
      targetProtein: user.targetProtein,
      targetCarb: user.targetCarb,
      targetFat: user.targetFat,
      macroStyle: user.macroStyle,
      goal: user.goal,
      mealsPerDay: user.mealsPerDay,
      dietType: user.dietType,
      allergies: user.allergies ?? [],
      timezone: resolveTimezone(user.timezone),
    };
  }

  /**
   * Tập món ĐÃ QUA bộ lọc an toàn (dị ứng + chế độ ăn là điều kiện lọc cứng). Mọi bước sau chỉ chọn trong tập này.
   */
  private safeFoods(user: PlanUser): PlanFood[] {
    return getAllowedFoods({ dietType: user.dietType, allergies: user.allergies });
  }

  /** Thực đơn gốc của một ngày, không phụ thuộc ngày khác. */
  private baseDay(userId: string, user: PlanUser, foods: PlanFood[], dateKey: string, avoid?: Set<string>) {
    return buildDayPlan(foods, {
      targetCalories: user.targetCalories,
      macroStyle: user.macroStyle,
      goal: user.goal,
      mealsPerDay: user.mealsPerDay,
      seed: `${userId}|${dateKey}`,
      avoid,
    });
  }

  /**
   * Thực đơn của một ngày, tránh lặp món so với 2 ngày liền trước (theo thực đơn THẬT của các ngày đó).
   * Để kết quả không phụ thuộc ngày bắt đầu truy vấn, chuỗi luôn được tính từ đầu khối 7 ngày chứa ngày đó
   * (khởi động trước 2 ngày), nên thực đơn hôm nay trong `today` và trong kế hoạch nhiều ngày luôn giống nhau.
   */
  private planForDate(
    userId: string,
    user: PlanUser,
    foods: PlanFood[],
    dateKey: string,
    cache: Map<string, DayPlan> = new Map(),
  ): DayPlan {
    const sinceEpoch = diffDays('1970-01-01', dateKey);
    const blockStart = addDaysToKey(dateKey, -(((sinceEpoch % 7) + 7) % 7));
    const length = diffDays(addDaysToKey(blockStart, -AVOID_REPEAT_DAYS), dateKey);
    const names = (plan: DayPlan) =>
      plan.slots.flatMap((slot) => slot.items.map((item) => item.name));

    let result!: DayPlan;
    for (let i = 0; i <= length; i++) {
      const key = addDaysToKey(blockStart, -AVOID_REPEAT_DAYS + i);
      let plan = cache.get(key);
      if (!plan) {
        const avoid = new Set<string>();
        for (let back = 1; back <= AVOID_REPEAT_DAYS; back++) {
          const prev = cache.get(addDaysToKey(key, -back));
          if (prev) names(prev).forEach((n) => avoid.add(n));
        }
        plan = this.baseDay(userId, user, foods, key, avoid);
        cache.set(key, plan);
      }
      result = plan;
    }
    return result;
  }

  private macroTargets(user: PlanUser) {
    return {
      calories: user.targetCalories,
      protein: user.targetProtein,
      carb: user.targetCarb,
      fat: user.targetFat,
    };
  }

  /** Thực đơn hôm nay kèm trạng thái đã ăn / chưa ăn và đề xuất cho phần ngân sách còn lại. */
  async getToday(userId: string) {
    const user = await this.loadUser(userId);
    const foods = this.safeFoods(user);
    const dateKey = todayKey(user.timezone);
    const limited = isLimitedChoice(foods);

    if (foods.length === 0) {
      return {
        date: dateKey,
        targetCalories: user.targetCalories,
        macroTargets: this.macroTargets(user),
        meals: [],
        totals: { calories: 0, protein: 0, carb: 0, fat: 0 },
        limitedChoices: true,
        message:
          'Không còn món nào phù hợp với dị ứng và chế độ ăn của bạn trong kho món. Hãy kiểm tra lại hồ sơ.',
      };
    }

    const plan = this.planForDate(userId, user, foods, dateKey);

    const logged = await this.prisma.meal.findMany({
      where: { userId, logDate: keyToDate(dateKey) },
      select: { mealType: true, totalCalories: true, items: { select: { name: true } } },
    });
    const consumed = new Map<string, number>();
    const loggedNames = new Set<string>();
    for (const meal of logged) {
      consumed.set(meal.mealType, (consumed.get(meal.mealType) ?? 0) + meal.totalCalories);
      for (const item of meal.items ?? []) loggedNames.add(item.name);
    }

    const meals = plan.slots.map((slot) => {
      const eaten = Math.round(consumed.get(slot.mealType) ?? 0);
      const remaining = Math.round(slot.budgetCalories - eaten);
      const status =
        eaten >= slot.budgetCalories * SLOT_DONE_RATIO ? 'LOGGED' : eaten > 0 ? 'PARTIAL' : 'PLANNED';

      let suggestionForRemaining: PlanSlot | null = null;
      if (status === 'PARTIAL' && remaining >= MIN_REMAINING_TO_SUGGEST) {
        suggestionForRemaining =
          buildDayPlan(foods, {
            targetCalories: user.targetCalories,
            macroStyle: user.macroStyle,
            mealsPerDay: user.mealsPerDay,
            seed: `${userId}|${dateKey}|rest`,
            slotBudgets: { [slot.mealType]: remaining } as Partial<Record<MealSlot, number>>,
            onlySlots: [slot.mealType],
            avoid: new Set(loggedNames),
          }).slots[0] ?? null;
      }

      return {
        ...slot,
        status,
        consumedCalories: eaten,
        remainingCalories: remaining, // âm khi bữa này đã ăn vượt ngân sách
        items: slot.items.map((item) => ({ ...item, logged: loggedNames.has(item.name) })),
        suggestionForRemaining,
      };
    });

    return {
      date: dateKey,
      targetCalories: user.targetCalories,
      macroTargets: this.macroTargets(user),
      meals,
      totals: plan.totals,
      limitedChoices: limited,
      message: limited ? LIMITED_MESSAGE : null,
    };
  }

  /**
   * Kế hoạch nhiều ngày bắt đầu từ hôm nay. 7 ngày: mọi gói đều xem đủ. 30 ngày: Free xem trước 7 ngày đầu, các
   * ngày sau chỉ trả khoá (mục đích là trải nghiệm trước khi mua, không phải bỏ tính năng).
   */
  async getPlan(userId: string, days: 7 | 30) {
    const user = await this.loadUser(userId);
    const foods = this.safeFoods(user);
    const limited = isLimitedChoice(foods);
    const startKey = todayKey(user.timezone);
    const previewOnly = days === 30 && (await isFreeTierLimited(this.prisma, userId));

    if (foods.length === 0) {
      return {
        startDate: startKey,
        days: [],
        previewDays: null,
        lockedFromDay: null,
        limitedChoices: true,
        message:
          'Không còn món nào phù hợp với dị ứng và chế độ ăn của bạn trong kho món. Hãy kiểm tra lại hồ sơ.',
      };
    }

    const cache = new Map<string, DayPlan>();
    const result: (
      | { dayNumber: number; date: string; locked: true }
      | ({ dayNumber: number; date: string; locked: false } & DayPlan)
    )[] = [];
    for (let i = 0; i < days; i++) {
      const dateKey = addDaysToKey(startKey, i);
      if (previewOnly && i >= FREE_PREVIEW_DAYS) {
        result.push({ dayNumber: i + 1, date: dateKey, locked: true });
        continue;
      }
      const plan = this.planForDate(userId, user, foods, dateKey, cache);
      result.push({ dayNumber: i + 1, date: dateKey, locked: false, ...plan });
    }

    return {
      startDate: startKey,
      targetCalories: user.targetCalories,
      macroTargets: this.macroTargets(user),
      days: result,
      previewDays: previewOnly ? FREE_PREVIEW_DAYS : null,
      lockedFromDay: previewOnly ? FREE_PREVIEW_DAYS + 1 : null,
      limitedChoices: limited,
      message: limited ? LIMITED_MESSAGE : null,
    };
  }

  /** Ngân sách từng bữa theo mục tiêu (dùng cho app/giải thích). */
  budgetsFor(targetCalories: number, mealsPerDay?: number | null) {
    return slotBudgetsFor(targetCalories, mealsPerDay);
  }
}
