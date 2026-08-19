import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMealDto } from './dto/create-meal.dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo một bữa ăn mới gồm nhiều món và tự động tính tổng Calories/Macros
   */
  async createMeal(userId: string, createMealDto: CreateMealDto) {
    const { mealType, date, imageUrl, items } = createMealDto;

    // 1. Tính tổng calories, protein, carb, fat từ các món ăn trong bữa
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

    // 2. Lưu Meal và các MealItem vào DB trong 1 Transaction
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
    // 1. Lấy thông tin User để lấy target calories & macros
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

    // 2. Lấy toàn bộ bữa ăn trong ngày
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

    const remainingCalories = Math.max(0, targetCalo - consumedCalories);
    const progressPercent = Math.min(100, Math.round((consumedCalories / targetCalo) * 100));

    return {
      message: 'Lấy tổng hợp dinh dưỡng trong ngày thành công',
      data: {
        date: dateStr || new Date().toISOString().split('T')[0],
        summary: {
          consumedCalories: Math.round(consumedCalories),
          targetCalories: targetCalo,
          remainingCalories: Math.round(remainingCalories),
          progressPercent,
          macros: {
            protein: { consumed: Math.round(consumedProtein), target: targetProtein, unit: 'g' },
            carb: { consumed: Math.round(consumedCarb), target: targetCarb, unit: 'g' },
            fat: { consumed: Math.round(consumedFat), target: targetFat, unit: 'g' },
          },
        },
        mealsCount: meals.length,
        meals,
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
