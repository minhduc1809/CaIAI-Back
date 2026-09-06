import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMealDto } from './dto/create-meal.dto';
import { UpdateMealDto } from './dto/update-meal.dto';
import { QuickAddMealDto } from './dto/quick-add-meal.dto';
import { CopyMealDto } from './dto/copy-meal.dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo một bữa ăn mới gồm nhiều món và tự động tính tổng Calories/Macros
   */
  async createMeal(userId: string, createMealDto: CreateMealDto) {
    const { mealType, date, imageUrl, items } = createMealDto;

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarb = 0;
    let totalFat = 0;

    const mealDate = new Date(date);

    for (const item of items) {
      const qty = item.quantity || 1;
      totalCalories += (item.calories || 0) * qty;
      totalProtein += (item.protein || 0) * qty;
      totalCarb += (item.carb || 0) * qty;
      totalFat += (item.fat || 0) * qty;
    }

    const meal = await this.prisma.meal.create({
      data: {
        userId,
        mealType,
        date: mealDate,
        imageUrl: imageUrl || null,
        totalCalories: Math.round(totalCalories * 10) / 10,
        totalProtein: Math.round(totalProtein * 10) / 10,
        totalCarb: Math.round(totalCarb * 10) / 10,
        totalFat: Math.round(totalFat * 10) / 10,
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
          })),
        },
      },
      include: {
        items: true,
      },
    });

    return {
      message: 'Ghi nhận bữa ăn thành công',
      data: meal,
    };
  }

  /**
   * Ghi nhận bữa ăn nhanh (Quick Add Calo/Macros không cần chọn từng món)
   */
  async quickAddMeal(userId: string, dto: QuickAddMealDto) {
    const { name, mealType, date, calories, protein = 0, carb = 0, fat = 0 } = dto;
    const mealDate = new Date(date);

    const meal = await this.prisma.meal.create({
      data: {
        userId,
        mealType,
        date: mealDate,
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

    let totalCalories = existing.totalCalories;
    let totalProtein = existing.totalProtein;
    let totalCarb = existing.totalCarb;
    let totalFat = existing.totalFat;

    // Nếu người dùng gửi danh sách items mới -> tính toán lại tổng
    if (dto.items && dto.items.length > 0) {
      totalCalories = 0;
      totalProtein = 0;
      totalCarb = 0;
      totalFat = 0;

      for (const item of dto.items) {
        const qty = item.quantity || 1;
        totalCalories += (item.calories || 0) * qty;
        totalProtein += (item.protein || 0) * qty;
        totalCarb += (item.carb || 0) * qty;
        totalFat += (item.fat || 0) * qty;
      }

      // Xóa items cũ và tạo items mới trong 1 transaction
      await this.prisma.$transaction([
        this.prisma.mealItem.deleteMany({ where: { mealId } }),
        this.prisma.mealItem.createMany({
          data: dto.items.map((item) => ({
            mealId,
            name: item.name,
            servingSize: item.servingSize || null,
            quantity: item.quantity || 1,
            calories: item.calories,
            protein: item.protein || 0,
            carb: item.carb || 0,
            fat: item.fat || 0,
            source: item.source || 'manual',
          })),
        }),
      ]);
    }

    const updatedMeal = await this.prisma.meal.update({
      where: { id: mealId },
      data: {
        mealType: dto.mealType !== undefined ? dto.mealType : existing.mealType,
        date: dto.date ? new Date(dto.date) : existing.date,
        imageUrl: dto.imageUrl !== undefined ? dto.imageUrl : existing.imageUrl,
        totalCalories: Math.round(totalCalories * 10) / 10,
        totalProtein: Math.round(totalProtein * 10) / 10,
        totalCarb: Math.round(totalCarb * 10) / 10,
        totalFat: Math.round(totalFat * 10) / 10,
      },
      include: {
        items: true,
      },
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

    const newDate = new Date(dto.targetDate);
    const newMealType = dto.mealType || existing.mealType;

    const clonedMeal = await this.prisma.meal.create({
      data: {
        userId,
        mealType: newMealType,
        date: newDate,
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
    let targetDate = new Date();
    if (dateStr) {
      targetDate = new Date(dateStr);
    }

    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
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

    const targetCalo = user?.targetCalories || 2000;
    const targetProtein = user?.targetProtein || 150;
    const targetCarb = user?.targetCarb || 200;
    const targetFat = user?.targetFat || 60;

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

    let targetDate = new Date();
    if (dateStr) {
      targetDate = new Date(dateStr);
    }
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    const workouts = await this.prisma.workoutLog.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
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

    // Energy Balance: Remaining = Target - Consumed + Active Calories Burned
    const remainingCalories = Math.max(0, targetCalo - consumedCalories + activeCaloriesBurned);
    const progressPercent = Math.min(100, Math.round((consumedCalories / targetCalo) * 100));

    return {
      message: 'Lấy tổng hợp dinh dưỡng trong ngày thành công',
      data: {
        date: dateStr || new Date().toISOString().split('T')[0],
        summary: {
          consumedCalories: Math.round(consumedCalories),
          targetCalories: targetCalo,
          activeCaloriesBurned,
          totalExerciseDurationMinutes,
          remainingCalories: Math.round(remainingCalories),
          progressPercent,
          macros: {
            protein: { consumed: Math.round(consumedProtein), target: targetProtein, unit: 'g' },
            carb: { consumed: Math.round(consumedCarb), target: targetCarb, unit: 'g' },
            fat: { consumed: Math.round(consumedFat), target: targetFat, unit: 'g' },
          },
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
  async getNutritionStatistics(userId: string, startDateStr?: string, endDateStr?: string) {
    const now = new Date();
    const endDate = endDateStr ? new Date(endDateStr) : now;
    const startDate = startDateStr ? new Date(startDateStr) : new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    const daysMap = new Map<string, { calories: number; protein: number; carb: number; fat: number; count: number }>();

    for (const meal of meals) {
      const dateKey = meal.date.toISOString().split('T')[0];
      const cur = daysMap.get(dateKey) || { calories: 0, protein: 0, carb: 0, fat: 0, count: 0 };
      cur.calories += meal.totalCalories;
      cur.protein += meal.totalProtein;
      cur.carb += meal.totalCarb;
      cur.fat += meal.totalFat;
      cur.count += 1;
      daysMap.set(dateKey, cur);
    }

    const dailyStats = Array.from(daysMap.entries()).map(([date, stats]) => ({
      date,
      calories: Math.round(stats.calories),
      protein: Math.round(stats.protein),
      carb: Math.round(stats.carb),
      fat: Math.round(stats.fat),
      mealsCount: stats.count,
    }));

    const totalLoggedDays = dailyStats.length || 1;
    const avgCalories = Math.round(dailyStats.reduce((sum, d) => sum + d.calories, 0) / totalLoggedDays);
    const avgProtein = Math.round(dailyStats.reduce((sum, d) => sum + d.protein, 0) / totalLoggedDays);
    const avgCarb = Math.round(dailyStats.reduce((sum, d) => sum + d.carb, 0) / totalLoggedDays);
    const avgFat = Math.round(dailyStats.reduce((sum, d) => sum + d.fat, 0) / totalLoggedDays);

    return {
      message: 'Lấy thống kê dinh dưỡng theo khoảng thời gian thành công',
      data: {
        period: {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
        },
        averages: {
          dailyCalories: avgCalories,
          dailyProtein: avgProtein,
          dailyCarb: avgCarb,
          dailyFat: avgFat,
        },
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
}
