import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMealDto } from './dto/create-meal.dto';
import { UpdateMealDto } from './dto/update-meal.dto';
import { QuickAddMealDto } from './dto/quick-add-meal.dto';
import { CopyMealDto } from './dto/copy-meal.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  addDaysToKey,
  dateToKey,
  dayBoundsForKey,
  keyToDate,
  normalizeDayKey,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import {
  isCompleteDay,
  loadDayFlags,
} from '../common/utils/day-completeness.util';

import { MealType } from '@prisma/client';
import { detectTextViolations } from '../recommendations/food-safety';

/** Giới hạn hợp lý chặn số liệu sai/nhập nhầm (kcal). */
const MAX_ITEM_KCAL = 10000;
const MAX_MEAL_KCAL = 15000;
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

export function resolveSourceType(
  sourceType?: string,
  source?: string,
): string {
  if (sourceType) return sourceType;
  if (source === 'quick_add') return 'QUICK_ADD';
  if (source === 'diet_plan') return 'DIET_PLAN';
  if (source === 'ai_vision') return 'AI_ESTIMATE';
  if (source === 'barcode') return 'BARCODE';
  if (source === 'custom') return 'CUSTOM';
  return 'CATALOG';
}

@Injectable()
export class MealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Múi giờ của user (BR-07.2); thiếu hoặc sai thì dùng múi giờ Việt Nam. */
  private async getUserTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return resolveTimezone(user?.timezone);
  }

  /**
   * Khoá ngày (YYYY-MM-DD) của bữa ăn: dùng đúng ngày user chọn nếu truyền YYYY-MM-DD, nếu truyền
   * mốc thời gian thì đổi sang ngày theo múi giờ user, nếu không truyền thì là hôm nay của user.
   */
  private async resolveLogDateKey(
    userId: string,
    input?: string | Date | null,
  ): Promise<string> {
    const tz = await this.getUserTimezone(userId);
    const key = normalizeDayKey(input, tz);
    if (!key) {
      throw new BadRequestException('Ngày không hợp lệ');
    }
    return key;
  }

  /**
   * Ngày dùng cho thao tác GHI (tạo, sửa, sao chép bữa ăn). Ghi bữa ăn là ghi lại việc đã ăn nên không
   * cho ngày tương lai theo múi giờ của user (xem/tra cứu ngày khác vẫn dùng resolveLogDateKey).
   */
  private async resolveWriteDayKey(
    userId: string,
    input?: string | Date | null,
  ): Promise<string> {
    const key = await this.resolveLogDateKey(userId, input);
    const tz = await this.getUserTimezone(userId);
    if (key > todayKey(tz)) {
      throw new BadRequestException(
        'Không thể ghi bữa ăn cho ngày trong tương lai',
      );
    }
    return key;
  }

  /**
   * Tổng calo/macro của danh sách món (calo của món là trên MỘT đơn vị `quantity`) và kiểm tra hợp lý:
   * một món không quá 10.000 kcal, một bữa không quá 15.000 kcal. Số liệu do app gửi lên nên server là
   * lớp chặn cuối trước khi nó làm sai trung bình, tiến độ và đề xuất mục tiêu.
   */
  private computeMealTotals(
    items: {
      quantity?: number;
      calories?: number;
      protein?: number;
      carb?: number;
      fat?: number;
    }[],
  ) {
    let calories = 0;
    let protein = 0;
    let carb = 0;
    let fat = 0;
    for (const item of items) {
      const qty = item.quantity || 1;
      const itemKcal = (item.calories || 0) * qty;
      if (itemKcal > MAX_ITEM_KCAL) {
        throw new BadRequestException(
          'Calo của một món vượt mức hợp lý, vui lòng kiểm tra lại số lượng',
        );
      }
      calories += itemKcal;
      protein += (item.protein || 0) * qty;
      carb += (item.carb || 0) * qty;
      fat += (item.fat || 0) * qty;
    }
    if (calories > MAX_MEAL_KCAL) {
      throw new BadRequestException(
        'Tổng calo của một bữa vượt mức hợp lý, vui lòng kiểm tra lại',
      );
    }
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      totalCalories: r(calories),
      totalProtein: r(protein),
      totalCarb: r(carb),
      totalFat: r(fat),
    };
  }

  /**
   * Khoá chống ghi trùng: cùng người, cùng nội dung bữa, trong cùng khung 2 phút → cùng khoá. Gửi lại yêu cầu
   * (bấm đúp, thử lại sau lỗi mạng khi lần đầu thực ra đã lưu) không tạo bữa thứ hai.
   */
  private mealDedupeKey(payload: unknown, now: number = Date.now()): string {
    const bucket = Math.floor(now / DEDUPE_WINDOW_MS);
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .update(String(bucket))
      .digest('hex');
  }

  /** Bữa đã có với khoá trùng (sau khi bị từ chối vì unique). */
  private async findDuplicate(userId: string, dedupeKey: string) {
    return this.prisma.meal.findFirst({
      where: { userId, dedupeKey },
      include: { items: true },
    });
  }

  /**
   * BR-13.1: đánh giá MỘT NGÀY ĐÃ KẾT THÚC. Chỉ khi ngày đó là ngày đầy đủ và tổng calo nằm trong 85–115%
   * mục tiêu thì tạo thông báo DAY_COMPLETED (chúc mừng); ngoài khoảng thì KHÔNG gửi gì (không phán xét).
   * Gọi lười (lazy) khi người dùng mở app sang ngày mới, tối đa một thông báo mỗi ngày.
   */
  async evaluateFinishedDay(userId: string, dayKey: string) {
    const tz = await this.getUserTimezone(userId);
    if (dayKey >= todayKey(tz)) return; // ngày chưa kết thúc

    const { start, end } = dayBoundsForKey(todayKey(tz), tz);
    const already = await this.prisma.notification.findFirst({
      where: {
        userId,
        type: 'DAY_COMPLETED',
        createdAt: { gte: start, lt: end },
      },
    });
    if (already) return;

    const [user, meals, flags] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { targetCalories: true },
      }),
      this.prisma.meal.findMany({
        where: { userId, logDate: keyToDate(dayKey) },
        select: { totalCalories: true },
      }),
      loadDayFlags(this.prisma, userId, dayKey, dayKey),
    ]);
    const target = user?.targetCalories;
    if (!target) return; // chưa có mục tiêu thì không có gì để so sánh
    const consumed = meals.reduce((sum, x) => sum + x.totalCalories, 0);
    if (!isCompleteDay(meals.length, consumed, target, flags.get(dayKey)))
      return;
    if (consumed < target * 0.85 || consumed > target * 1.15) return;

    await this.notificationsService.create(
      userId,
      'DAY_COMPLETED',
      'Bạn đã hoàn thành tốt ngày hôm qua!',
      `Bạn nạp ${Math.round(consumed)} kcal, sát mục tiêu ${Math.round(target)} kcal.`,
    );
  }

  /**
   * Tạo một bữa ăn mới gồm nhiều món và tự động tính tổng Calories/Macros
   */
  async createMeal(userId: string, createMealDto: CreateMealDto) {
    const { mealType, date, imageUrl, items, clientRequestId } = createMealDto;

    // Chống ghi trùng qua clientRequestId khi retry/offline (BR-07.5)
    if (clientRequestId) {
      const existingReq = await this.prisma.meal.findFirst({
        where: { userId, clientRequestId },
        include: { items: true },
      });
      if (existingReq) {
        return { message: 'Bữa ăn này đã được ghi nhận', data: existingReq };
      }
    }

    const logDateKey = await this.resolveWriteDayKey(userId, date);
    const mealDate = keyToDate(logDateKey);
    const totals = this.computeMealTotals(items);
    const dedupeKey = this.mealDedupeKey({
      userId,
      mealType,
      logDateKey,
      items: items.map((i) => [
        i.name,
        i.quantity || 1,
        i.calories,
        i.protein || 0,
        i.carb || 0,
        i.fat || 0,
      ]),
    });

    let meal;
    try {
      meal = await this.prisma.meal.create({
        data: {
          userId,
          mealType,
          date: mealDate,
          logDate: mealDate,
          imageUrl: imageUrl || null,
          dedupeKey,
          clientRequestId: clientRequestId || null,
          ...totals,
          items: {
            create: items.map((item) => ({
              name: item.name,
              servingSize: item.servingSize || null,
              servingAmount: item.servingAmount ?? null,
              servingUnit: item.servingUnit || null,
              quantity: item.quantity || 1,
              calories: item.calories,
              protein: item.protein || 0,
              carb: item.carb || 0,
              fat: item.fat || 0,
              source: item.source || 'manual',
              sourceType: resolveSourceType(item.sourceType, item.source),
              sourceId: item.sourceId || null,
            })),
          },
        },
        include: {
          items: true,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        if (clientRequestId) {
          const byReq = await this.prisma.meal.findFirst({
            where: { userId, clientRequestId },
            include: { items: true },
          });
          if (byReq) {
            return { message: 'Bữa ăn này đã được ghi nhận', data: byReq };
          }
        }
        const existing = await this.findDuplicate(userId, dedupeKey);
        if (existing) {
          return { message: 'Bữa ăn này đã được ghi nhận', data: existing };
        }
      }
      throw e;
    }

    return {
      message: 'Ghi nhận bữa ăn thành công',
      data: meal,
    };
  }

  /**
   * Ghi nhận bữa ăn nhanh (Quick Add Calo/Macros không cần chọn từng món)
   */
  async quickAddMeal(userId: string, dto: QuickAddMealDto) {
    const {
      name,
      mealType,
      date,
      calories,
      protein = 0,
      carb = 0,
      fat = 0,
    } = dto;
    const logDateKey = await this.resolveWriteDayKey(userId, date);
    const mealDate = keyToDate(logDateKey);

    const dedupeKey = this.mealDedupeKey({
      userId,
      mealType,
      logDateKey,
      quick: [name, calories, protein, carb, fat],
    });

    let meal;
    try {
      meal = await this.prisma.meal.create({
        data: {
          userId,
          mealType,
          date: mealDate,
          logDate: mealDate,
          dedupeKey,
          totalCalories: calories,
          totalProtein: protein,
          totalCarb: carb,
          totalFat: fat,
          items: {
            create: [
              {
                name,
                servingSize: '1 phần',
                quantity: 1,
                calories,
                protein,
                carb,
                fat,
                source: 'quick_add',
              },
            ],
          },
        },
        include: {
          items: true,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const existing = await this.findDuplicate(userId, dedupeKey);
        if (existing) {
          return { message: 'Bữa ăn này đã được ghi nhận', data: existing };
        }
      }
      throw e;
    }

    return {
      message: 'Ghi nhận calo nhanh thành công',
      data: meal,
    };
  }

  /**
   * Lấy chi tiết một bữa ăn theo ID
   */
  async getMealDetail(userId: string, mealId: string) {
    const meal = await this.prisma.meal.findUnique({
      where: { id: mealId },
      include: { items: true },
    });

    if (!meal) {
      throw new NotFoundException('Không tìm thấy bữa ăn');
    }

    if (meal.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập bữa ăn này');
    }

    return {
      message: 'Lấy chi tiết bữa ăn thành công',
      data: meal,
    };
  }

  /**
   * Cập nhật thông tin bữa ăn và danh sách món ăn
   */
  async updateMeal(userId: string, mealId: string, dto: UpdateMealDto) {
    const existing = await this.prisma.meal.findUnique({
      where: { id: mealId },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy bữa ăn');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền sửa bữa ăn này');
    }

    // Xoá món cuối cùng khỏi bữa ăn (items=[]) thì xoá luôn cả bữa ăn — 1 bữa 0 món là vô nghĩa.
    // App phải hỏi xác nhận người dùng trước khi gửi yêu cầu này.
    if (dto.items && dto.items.length === 0) {
      await this.prisma.meal.delete({ where: { id: mealId } });
      return {
        message: 'Đã xoá món cuối cùng — bữa ăn được xoá theo',
        data: null,
      };
    }

    const newLogDate = dto.date
      ? keyToDate(await this.resolveWriteDayKey(userId, dto.date))
      : null;
    const newTotals = dto.items ? this.computeMealTotals(dto.items) : null;

    // Thay món + cập nhật tổng + đổi ngày/loại bữa trong MỘT transaction: lỗi giữa chừng thì không có gì
    // thay đổi, không bao giờ để lại danh sách món mới đi kèm tổng cũ.
    const updatedMeal = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.mealItem.deleteMany({ where: { mealId } });
        await tx.mealItem.createMany({
          data: dto.items.map((item) => ({
            mealId,
            name: item.name,
            servingSize: item.servingSize || null,
            servingAmount: item.servingAmount ?? null,
            servingUnit: item.servingUnit || null,
            quantity: item.quantity || 1,
            calories: item.calories,
            protein: item.protein || 0,
            carb: item.carb || 0,
            fat: item.fat || 0,
            source: item.source || 'manual',
            sourceType: resolveSourceType(item.sourceType, item.source),
            sourceId: item.sourceId || null,
          })),
        });
      }
      return tx.meal.update({
        where: { id: mealId },
        data: {
          mealType:
            dto.mealType !== undefined ? dto.mealType : existing.mealType,
          date: newLogDate ?? existing.date,
          logDate: newLogDate ?? existing.logDate,
          imageUrl:
            dto.imageUrl !== undefined ? dto.imageUrl : existing.imageUrl,
          ...(newTotals ?? {}),
        },
        include: { items: true },
      });
    });

    return {
      message: 'Cập nhật bữa ăn thành công',
      data: updatedMeal,
    };
  }

  /**
   * Sao chép bữa ăn sang ngày khác (Copy & Paste meal theo BRD)
   */
  async copyMeal(userId: string, mealId: string, dto: CopyMealDto) {
    const existing = await this.prisma.meal.findUnique({
      where: { id: mealId },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy bữa ăn cần sao chép');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền sao chép bữa ăn này');
    }

    const newDate = keyToDate(
      await this.resolveWriteDayKey(userId, dto.targetDate),
    );
    const newMealType = dto.mealType || existing.mealType;

    const clonedMeal = await this.prisma.meal.create({
      data: {
        userId,
        mealType: newMealType,
        date: newDate,
        logDate: newDate,
        imageUrl: existing.imageUrl,
        totalCalories: existing.totalCalories,
        totalProtein: existing.totalProtein,
        totalCarb: existing.totalCarb,
        totalFat: existing.totalFat,
        items: {
          create: existing.items.map((item) => ({
            name: item.name,
            servingSize: item.servingSize,
            quantity: item.quantity,
            calories: item.calories,
            protein: item.protein,
            carb: item.carb,
            fat: item.fat,
            source: 'copied',
          })),
        },
      },
      include: {
        items: true,
      },
    });

    return {
      message: 'Sao chép bữa ăn thành công',
      data: clonedMeal,
    };
  }

  /**
   * Lấy danh sách các bữa ăn theo ngày cụ thể (YYYY-MM-DD)
   */
  async getMealsByDate(userId: string, dateStr?: string) {
    const dayKey = await this.resolveLogDateKey(userId, dateStr);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: keyToDate(dayKey),
      },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      message: 'Lấy danh sách bữa ăn thành công',
      data: meals,
    };
  }

  /**
   * Thống kê dinh dưỡng trong ngày: So sánh với Target của User
   */
  async getDailyNutritionSummary(userId: string, dateStr?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
      },
    });

    // Chưa có mục tiêu (hồ sơ chưa hoàn tất) thì trả null, KHÔNG bịa mục tiêu mặc định để người mới
    // không thấy con số vô nghĩa. App hiển thị "Hoàn tất hồ sơ".
    const targetCalo = user?.targetCalories || null;
    const targetProtein = user?.targetProtein || null;
    const targetCarb = user?.targetCarb || null;
    const targetFat = user?.targetFat || null;

    const mealsResponse = await this.getMealsByDate(userId, dateStr);
    const meals = mealsResponse.data;

    let consumedCalories = 0;
    let consumedProtein = 0;
    let consumedCarb = 0;
    let consumedFat = 0;

    for (const meal of meals) {
      consumedCalories += meal.totalCalories;
      consumedProtein += meal.totalProtein;
      consumedCarb += meal.totalCarb;
      consumedFat += meal.totalFat;
    }

    const dayKey = await this.resolveLogDateKey(userId, dateStr);
    // Mở app vào ngày mới: lười đánh giá ngày hôm qua để gửi DAY_COMPLETED (không làm hỏng summary nếu lỗi)
    const tzNow = await this.getUserTimezone(userId);
    if (dayKey === todayKey(tzNow)) {
      await this.evaluateFinishedDay(userId, addDaysToKey(dayKey, -1)).catch(
        () => undefined,
      );
    }
    const dayFlags = await loadDayFlags(this.prisma, userId, dayKey, dayKey);
    const dayFlag = dayFlags.get(dayKey) ?? 'AUTO';

    // Buổi tập lưu theo ngày dạng YYYY-MM-DD (00:00 UTC) giống bữa ăn
    const workouts = await this.prisma.workoutLog.findMany({
      where: {
        userId,
        date: {
          gte: keyToDate(dayKey),
          lt: keyToDate(addDaysToKey(dayKey, 1)),
        },
      },
      select: { caloriesBurned: true, durationMinutes: true },
    });

    const activeCaloriesBurned = Math.round(
      workouts.reduce((sum, w) => sum + (w.caloriesBurned || 0), 0),
    );
    const totalExerciseDurationMinutes = workouts.reduce(
      (sum, w) => sum + w.durationMinutes,
      0,
    );

    // BR-03.2: Còn lại = Mục tiêu − Đã ăn. KHÔNG cộng calo tập luyện vì hệ số vận động (và
    // Expenditure học từ dữ liệu) đã gồm việc tập; cộng lại là đếm trùng. Calo tập chỉ để hiển thị.
    // Còn lại có thể ÂM khi ăn vượt; `overCalories` là phần vượt (>= 0) để app hiển thị rõ, không phán xét.
    // `progressPercent` bị kẹp ở 100 để vẽ vòng; mức vượt xem ở `overCalories`.
    const remainingCalories =
      targetCalo === null ? null : targetCalo - consumedCalories;
    const overCalories =
      targetCalo === null ? 0 : Math.max(0, consumedCalories - targetCalo);
    const progressPercent =
      targetCalo === null
        ? null
        : Math.min(100, Math.round((consumedCalories / targetCalo) * 100));

    return {
      message: 'Lấy tổng hợp dinh dưỡng trong ngày thành công',
      data: {
        date: dayKey,
        summary: {
          consumedCalories: Math.round(consumedCalories),
          targetCalories: targetCalo,
          activeCaloriesBurned,
          exerciseCalories: activeCaloriesBurned,
          totalExerciseDurationMinutes,
          remainingCalories:
            remainingCalories === null ? null : Math.round(remainingCalories),
          overCalories: Math.round(overCalories),
          hasTarget: targetCalo !== null,
          progressPercent,
          macros: {
            protein: {
              consumed: Math.round(consumedProtein),
              target: targetProtein,
              unit: 'g',
            },
            carb: {
              consumed: Math.round(consumedCarb),
              target: targetCarb,
              unit: 'g',
            },
            fat: {
              consumed: Math.round(consumedFat),
              target: targetFat,
              unit: 'g',
            },
          },
        },
        // BR-05.2 / BR-07.6: trạng thái "đầy đủ" của ngày để Home hiển thị nút "Đã ghi đủ hôm nay"
        logStatus: {
          completeness: dayFlag,
          isComplete: isCompleteDay(
            meals.length,
            consumedCalories,
            targetCalo ?? 0,
            dayFlag,
          ),
        },
        mealsCount: meals.length,
        workoutsCount: workouts.length,
        meals,
      },
    };
  }

  /**
   * Thống kê dinh dưỡng theo dải ngày (7 ngày gần nhất hoặc tùy chọn)
   */
  async getNutritionStatistics(
    userId: string,
    startDateStr?: string,
    endDateStr?: string,
    preset?: 'week' | 'month' | 'quarter' | 'year' | 'all',
  ) {
    const tz = await this.getUserTimezone(userId);
    const endKey = normalizeDayKey(endDateStr || undefined, tz);
    if (!endKey) throw new BadRequestException('endDate không hợp lệ');

    let startKey: string;
    if (startDateStr) {
      const k = normalizeDayKey(startDateStr, tz);
      if (!k) throw new BadRequestException('startDate không hợp lệ');
      startKey = k;
    } else if (preset && preset !== 'week') {
      const presetDays: Record<'month' | 'quarter' | 'year', number> = {
        month: 30,
        quarter: 90,
        year: 365,
      };
      if (preset === 'all') {
        const earliestMeal = await this.prisma.meal.findFirst({
          where: { userId },
          orderBy: { logDate: 'asc' },
        });
        startKey = earliestMeal
          ? dateToKey(earliestMeal.logDate)
          : addDaysToKey(endKey, -6);
      } else {
        startKey = addDaysToKey(endKey, -presetDays[preset]);
      }
    } else {
      // Mặc định (không truyền gì hoặc preset='week'): 7 ngày gần nhất
      startKey = addDaysToKey(endKey, -6);
    }

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: {
          gte: keyToDate(startKey),
          lte: keyToDate(endKey),
        },
      },
      orderBy: {
        logDate: 'asc',
      },
    });

    const daysMap = new Map<
      string,
      {
        calories: number;
        protein: number;
        carb: number;
        fat: number;
        count: number;
      }
    >();

    for (const meal of meals) {
      const dateKey = dateToKey(meal.logDate);
      const cur = daysMap.get(dateKey) || {
        calories: 0,
        protein: 0,
        carb: 0,
        fat: 0,
        count: 0,
      };
      cur.calories += meal.totalCalories;
      cur.protein += meal.totalProtein;
      cur.carb += meal.totalCarb;
      cur.fat += meal.totalFat;
      cur.count += 1;
      daysMap.set(dateKey, cur);
    }

    // Cùng định nghĩa "ngày đầy đủ" (BR-05.2) với Check-in và Expenditure: chỉ ngày đầy đủ mới được tính
    // vào trung bình. Ngày chỉ ghi một ly nước cam hay ngày hôm nay mới ghi nửa chừng không kéo số xuống.
    const [targetUser, flags] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { targetCalories: true },
      }),
      loadDayFlags(this.prisma, userId, startKey, endKey),
    ]);
    const targetCalo = targetUser?.targetCalories ?? 0;

    const dailyStats = Array.from(daysMap.entries()).map(([date, stats]) => ({
      date,
      calories: Math.round(stats.calories),
      protein: Math.round(stats.protein),
      carb: Math.round(stats.carb),
      fat: Math.round(stats.fat),
      mealsCount: stats.count,
      isComplete: isCompleteDay(
        stats.count,
        stats.calories,
        targetCalo,
        flags.get(date),
      ),
    }));

    const completeStats = dailyStats.filter((d) => d.isComplete);
    const avg = (pick: (d: (typeof dailyStats)[number]) => number) =>
      completeStats.length === 0
        ? 0
        : Math.round(
            completeStats.reduce((sum, d) => sum + pick(d), 0) /
              completeStats.length,
          );
    const avgCalories = avg((d) => d.calories);
    const avgProtein = avg((d) => d.protein);
    const avgCarb = avg((d) => d.carb);
    const avgFat = avg((d) => d.fat);

    return {
      message: 'Lấy thống kê dinh dưỡng theo khoảng thời gian thành công',
      data: {
        period: {
          start: startKey,
          end: endKey,
        },
        averages: {
          dailyCalories: avgCalories,
          dailyProtein: avgProtein,
          dailyCarb: avgCarb,
          dailyFat: avgFat,
        },
        // Số ngày có ghi và số ngày đầy đủ dùng để tính trung bình (0 ngày đầy đủ → trung bình = 0, "chưa đủ dữ liệu")
        loggedDays: dailyStats.length,
        completeDays: completeStats.length,
        dailyStats,
      },
    };
  }

  /**
   * Xóa bữa ăn
   */
  async deleteMeal(userId: string, mealId: string) {
    const meal = await this.prisma.meal.findUnique({
      where: { id: mealId },
    });

    if (!meal) {
      throw new NotFoundException('Không tìm thấy bữa ăn');
    }

    if (meal.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xóa bữa ăn này');
    }

    await this.prisma.meal.delete({
      where: { id: mealId },
    });

    return {
      message: 'Xóa bữa ăn thành công',
    };
  }

  /**
   * Tóm tắt dinh dưỡng cho 1 tuần (7 ngày liên tiếp bắt đầu từ `startDate`) — dùng để vẽ trạng
   * thái từng ngày trên Week Strip (đạt mục tiêu / chưa đủ / không log) thay vì đoán mò phía App.
   * Chỉ gom nhẹ totalCalories theo ngày (không kèm workout/macro) vì Week Strip chỉ cần biết
   * "ngày đó có ăn chưa, ăn có đạt mục tiêu không" — không cần chi tiết như getDailyNutritionSummary.
   */
  async getWeekSummary(userId: string, startDateStr: string) {
    const tz = await this.getUserTimezone(userId);
    const startKey = normalizeDayKey(startDateStr, tz);
    if (!startKey) throw new BadRequestException('startDate không hợp lệ');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { targetCalories: true },
    });
    const targetCalo = user?.targetCalories ?? 0; // 0 = chưa có mục tiêu
    const endKey = addDaysToKey(startKey, 6);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: { gte: keyToDate(startKey), lte: keyToDate(endKey) },
      },
      select: { logDate: true, totalCalories: true },
    });
    const weekFlags = await loadDayFlags(this.prisma, userId, startKey, endKey);

    const byDate = new Map<string, number>();
    const mealCountByDate = new Map<string, number>();
    for (const meal of meals) {
      const key = dateToKey(meal.logDate);
      byDate.set(key, (byDate.get(key) || 0) + meal.totalCalories);
      mealCountByDate.set(key, (mealCountByDate.get(key) || 0) + 1);
    }

    const days: {
      date: string;
      consumedCalories: number;
      targetCalories: number;
      hasData: boolean;
      metGoal: boolean;
      completeness: string;
      isComplete: boolean;
    }[] = [];
    for (let i = 0; i < 7; i++) {
      const key = addDaysToKey(startKey, i);
      const consumed = Math.round(byDate.get(key) || 0);
      days.push({
        date: key,
        consumedCalories: consumed,
        targetCalories: Math.round(targetCalo),
        hasData: byDate.has(key),
        completeness: weekFlags.get(key) ?? 'AUTO',
        isComplete: isCompleteDay(
          mealCountByDate.get(key) || 0,
          byDate.get(key) || 0,
          targetCalo,
          weekFlags.get(key),
        ),
        // "Đạt mục tiêu" nghĩa là đã log và nạp trong khoảng 85-115% target — tránh vừa thiếu
        // nhiều vừa thừa nhiều đều báo "đạt" sai lệch.
        metGoal:
          targetCalo > 0 &&
          byDate.has(key) &&
          consumed >= targetCalo * 0.85 &&
          consumed <= targetCalo * 1.15,
      });
    }

    return { message: 'Lấy tóm tắt tuần thành công', data: days };
  }

  /**
   * Món quen (BR-07.7): 20 món được log nhiều nhất trong 30 ngày gần nhất,
   * kèm khẩu phần lần gần nhất. Lọc món có calories = 0 và món vi phạm dị ứng/chế độ ăn.
   */
  async getFrequentFoods(userId: string, mealType?: MealType) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dietType: true, allergies: true },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: { gte: thirtyDaysAgo },
        ...(mealType ? { mealType } : {}),
      },
      include: {
        items: true,
      },
      orderBy: { logDate: 'desc' },
    });

    const groupMap = new Map<
      string,
      {
        count: number;
        lastUsedAt: Date;
        mealType: MealType;
        name: string;
        servingSize: string | null;
        servingAmount: number | null;
        servingUnit: any;
        quantity: number;
        calories: number;
        protein: number;
        carb: number;
        fat: number;
        sourceType: string;
        sourceId: string | null;
      }
    >();

    for (const meal of meals) {
      for (const item of meal.items) {
        if (!item.calories || item.calories <= 0) continue;

        // Kiểm tra an toàn dị ứng / ăn kiêng
        if (user) {
          const violations = detectTextViolations(item.name, {
            dietType: user.dietType,
            allergies: user.allergies ?? [],
          });
          if (violations.length > 0) continue;
        }

        const sType =
          item.sourceType || resolveSourceType(undefined, item.source);
        const sId = item.sourceId || null;
        const key = sId ? `${sType}:${sId}` : item.name.trim().toLowerCase();

        const existing = groupMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          groupMap.set(key, {
            count: 1,
            lastUsedAt: meal.logDate,
            mealType: meal.mealType,
            name: item.name,
            servingSize: item.servingSize,
            servingAmount: item.servingAmount,
            servingUnit: item.servingUnit,
            quantity: item.quantity,
            calories: item.calories,
            protein: item.protein,
            carb: item.carb,
            fat: item.fat,
            sourceType: sType,
            sourceId: sId,
          });
        }
      }
    }

    const frequentList = Array.from(groupMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      message: 'Lấy danh sách món quen thành công',
      data: frequentList,
    };
  }
}
