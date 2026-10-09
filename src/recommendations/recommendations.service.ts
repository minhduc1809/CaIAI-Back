import { getPlanLimits } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { refundDaily, reserveDaily } from '../billing/daily-counter';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { dayBoundsForKey, resolveTimezone, todayKey } from '../common/utils/date-zone.util';
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCustomFoodDto } from './dto/create-custom-food.dto';
import { Gender, GoalType, WorkoutLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  VIETNAMESE_WORKOUT_PLANS,
  WorkoutTemplatePlan,
} from './data/vietnamese-workout.data';
import { MALE_EXERCISES, FEMALE_EXERCISES } from './data/gender-exercises.data';
import {
  VIETNAMESE_FOODS_DATA,
  SeedFoodItem,
} from './data/vietnamese-food-database.data';

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tra cứu danh sách các món ăn Việt Nam chuẩn Viện Dinh Dưỡng (hỗ trợ search và filter theo category)
   */
  async searchFoodItems(query?: string, category?: string) {
    let results = VIETNAMESE_FOODS_DATA;

    if (query) {
      const q = query.toLowerCase().trim();
      results = results.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.note && f.note.toLowerCase().includes(q)),
      );
    }

    if (category) {
      results = results.filter((f) => f.category === category);
    }

    return {
      message: 'Tra cứu danh sách món ăn thành công',
      data: {
        total: results.length,
        items: results,
      },
    };
  }

  /**
   * Lấy danh mục các nhóm thực phẩm
   */
  async getFoodCategories() {
    const categories = [
      'Cơm - Tinh bột',
      'Bún - Phở - Mì',
      'Thịt - Gia cầm',
      'Hải sản - Cá',
      'Rau củ - Canh',
      'Trái cây - Đồ uống',
    ];

    return {
      message: 'Lấy danh mục nhóm thực phẩm thành công',
      data: categories,
    };
  }

  /**
   * Gợi ý Lộ trình tập luyện phù hợp nhất với BMI và Goal của người dùng
   */
  async getWorkoutRecommendation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        bmi: true,
        goal: true,
        activityLevel: true,
      },
    });

    const userGoal = user?.goal || GoalType.LOSE_WEIGHT;
    const userBmi = user?.bmi || 22;

    // 1. Lọc kế hoạch tập theo Goal
    let suitablePlan: WorkoutTemplatePlan | undefined;

    if (userGoal === GoalType.GAIN_WEIGHT) {
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find(
        (w) => w.goal === GoalType.GAIN_WEIGHT,
      );
    } else if (userGoal === GoalType.MAINTAIN) {
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find(
        (w) => w.goal === GoalType.MAINTAIN,
      );
    } else {
      // LOSE_WEIGHT: Chọn bài tập an toàn cho khớp gối nếu BMI cao
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find(
        (w) => w.goal === GoalType.LOSE_WEIGHT,
      );
    }

    if (!suitablePlan) {
      suitablePlan = VIETNAMESE_WORKOUT_PLANS[0];
    }

    return {
      message: 'Gợi ý lộ trình tập luyện cá nhân hóa thành công',
      data: {
        userProfile: {
          bmi: userBmi,
          goal: userGoal,
          activityLevel: user?.activityLevel,
        },
        recommendedWorkout: suitablePlan,
        allWorkoutPlans: VIETNAMESE_WORKOUT_PLANS.map((w) => ({
          id: w.id,
          title: w.title,
          goal: w.goal,
          level: w.level,
          suitableForBmi: w.suitableForBmi,
        })),
      },
    };
  }

  /**
   * Báo cáo tổng hợp trọn gói cả Thực đơn + Lịch tập
   */
  async getRecommendationsOverview(userId: string) {
    const workoutResult = await this.getWorkoutRecommendation(userId);

    return {
      message: 'Lấy trọn bộ gói gợi ý cá nhân hóa thành công',
      data: {
        workout: workoutResult.data,
      },
    };
  }

  /**
   * Lấy danh sách 50 bài tập được tối ưu riêng theo giới tính (Nam / Nữ) và cấp độ (Beginner / Intermediate / Advanced)
   */
  async getGenderExercises(
    userId: string,
    genderQuery?: string,
    levelQuery?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        gender: true,
      },
    });

    // Xác định giới tính mục tiêu
    let targetGender: Gender = Gender.MALE;
    if (genderQuery) {
      targetGender =
        genderQuery.toUpperCase() === 'FEMALE' ? Gender.FEMALE : Gender.MALE;
    } else if (user?.gender === Gender.FEMALE) {
      targetGender = Gender.FEMALE;
    }

    const exercisePool =
      targetGender === Gender.FEMALE ? FEMALE_EXERCISES : MALE_EXERCISES;

    // Lọc theo level nếu có query
    let filteredList = exercisePool;
    if (levelQuery) {
      const upperLevel = levelQuery.toUpperCase();
      if (
        upperLevel === 'BEGINNER' ||
        upperLevel === 'INTERMEDIATE' ||
        upperLevel === 'ADVANCED'
      ) {
        filteredList = exercisePool.filter((ex) => ex.level === upperLevel);
      }
    }

    return {
      message: `Lấy danh sách bài tập cho ${targetGender === Gender.FEMALE ? 'Nữ' : 'Nam'} thành công`,
      data: {
        gender: targetGender,
        totalCount: exercisePool.length,
        filteredCount: filteredList.length,
        levelsSummary: {
          beginner: exercisePool.filter(
            (e) => e.level === WorkoutLevel.BEGINNER,
          ).length,
          intermediate: exercisePool.filter(
            (e) => e.level === WorkoutLevel.INTERMEDIATE,
          ).length,
          advanced: exercisePool.filter(
            (e) => e.level === WorkoutLevel.ADVANCED,
          ).length,
        },
        exercises: filteredList,
      },
    };
  }

  /**
   * Xem chi tiết hướng dẫn thực hiện 1 bài tập cụ thể
   */
  async getExerciseDetail(exerciseId: string) {
    const allExercises = [...MALE_EXERCISES, ...FEMALE_EXERCISES];
    const exercise = allExercises.find((ex) => ex.id === exerciseId);

    if (!exercise) {
      return {
        message: 'Không tìm thấy bài tập',
        data: null,
      };
    }

    return {
      message: 'Lấy chi tiết hướng dẫn bài tập thành công',
      data: exercise,
    };
  }

  /**
   * Tạo món ăn tự tạo riêng của người dùng (Custom Food) — hỗ trợ 2 chế độ:
   * đơn giản (nhập thẳng tổng calo/macro) hoặc Recipe nhiều nguyên liệu
   * (calo/macro tổng tự tính bằng tổng các `ingredients`, không cần nhập tay).
   */
  async createCustomFood(userId: string, dto: CreateCustomFoodDto) {
    const hasIngredients = dto.ingredients && dto.ingredients.length > 0;

    if (!hasIngredients && dto.calories === undefined) {
      throw new BadRequestException(
        'Phải nhập Calories hoặc cung cấp danh sách ingredients',
      );
    }

    const totals = hasIngredients
      ? dto.ingredients!.reduce(
          (acc, ing) => ({
            calories: acc.calories + (ing.calories || 0),
            protein: acc.protein + (ing.protein || 0),
            carb: acc.carb + (ing.carb || 0),
            fat: acc.fat + (ing.fat || 0),
          }),
          { calories: 0, protein: 0, carb: 0, fat: 0 },
        )
      : {
          calories: dto.calories!,
          protein: dto.protein || 0,
          carb: dto.carb || 0,
          fat: dto.fat || 0,
        };

    const food = await this.prisma.customFood.create({
      data: {
        userId,
        name: dto.name,
        servingSize: dto.servingSize || null,
        servingAmount: dto.servingAmount ?? null,
        servingUnit: dto.servingUnit || null,
        calories: totals.calories,
        protein: totals.protein,
        carb: totals.carb,
        fat: totals.fat,
        ingredients: hasIngredients ? (dto.ingredients as any) : undefined,
      },
    });

    return {
      message: 'Tạo món ăn riêng thành công',
      data: food,
    };
  }

  /**
   * Lấy danh sách món ăn riêng của người dùng
   */
  async getCustomFoods(userId: string) {
    const foods = await this.prisma.customFood.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Lấy danh sách món ăn riêng thành công',
      data: foods,
    };
  }

  /**
   * Xóa món ăn riêng
   */
  async deleteCustomFood(userId: string, id: string) {
    const food = await this.prisma.customFood.findUnique({
      where: { id },
    });

    if (!food || food.userId !== userId) {
      return {
        message: 'Không tìm thấy món ăn',
      };
    }

    await this.prisma.customFood.delete({ where: { id } });

    return {
      message: 'Xóa món ăn riêng thành công',
    };
  }

  /**
   * Tra cứu thông tin dinh dưỡng theo mã vạch (Barcode Scanner) qua OpenFoodFacts API công khai.
   * Nutriments của OpenFoodFacts tính theo 100g/100ml — quy đổi sẵn về "1 khẩu phần chuẩn" (100g) để app dùng trực tiếp.
   */
  async lookupBarcode(userId: string, barcode: string) {
    // Hạn mức theo gói (Free giới hạn số lượt/ngày); lượt không dùng được vì lỗi mạng sẽ được hoàn lại
    const limits = await getPlanLimits(this.prisma, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = resolveTimezone(user?.timezone);
    const date = todayKey(tz);
    const ok = await reserveDaily(this.prisma, userId, date, 'barcodeLookups', limits.barcodePerDay);
    if (!ok) {
      throw new QuotaExceededException({
        feature: 'BARCODE',
        limit: limits.barcodePerDay,
        used: limits.barcodePerDay,
        period: 'day',
        resetsAt: dayBoundsForKey(date, tz).end,
        premiumBenefit: `Mở Premium để tra mã vạch tới ${PLAN_LIMITS.PREMIUM.barcodePerDay} lượt mỗi ngày.`,
        isPremium: limits.barcodePerDay >= PLAN_LIMITS.PREMIUM.barcodePerDay,
      });
    }

    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      );
      const json = await response.json();

      if (json.status !== 1 || !json.product) {
        return {
          message: 'Không tìm thấy sản phẩm với mã vạch này',
          data: null,
        };
      }

      const product = json.product;
      const nutriments = product.nutriments || {};

      return {
        message: 'Tra cứu mã vạch thành công',
        data: {
          barcode,
          name:
            product.product_name ||
            product.product_name_vi ||
            'Sản phẩm không tên',
          brand: product.brands || null,
          imageUrl: product.image_url || null,
          servingSize: product.serving_size || '100g',
          servingAmount: 100,
          servingUnit: 'GRAM',
          calories: Math.round((nutriments['energy-kcal_100g'] || 0) * 10) / 10,
          protein: Math.round((nutriments['proteins_100g'] || 0) * 10) / 10,
          carb: Math.round((nutriments['carbohydrates_100g'] || 0) * 10) / 10,
          fat: Math.round((nutriments['fat_100g'] || 0) * 10) / 10,
        },
      };
    } catch (error) {
      await refundDaily(this.prisma, userId, date, 'barcodeLookups');
      return {
        message: 'Không thể tra cứu mã vạch lúc này, vui lòng thử lại',
        data: null,
      };
    }
  }

  /**
   * Thêm món ăn vào danh sách yêu thích
   */
  async addFavoriteFood(userId: string, foodName: string) {
    const fav = await this.prisma.favoriteFood.upsert({
      where: {
        userId_foodName: {
          userId,
          foodName,
        },
      },
      update: {},
      create: {
        userId,
        foodName,
      },
    });

    return {
      message: 'Đã thêm món vào danh sách yêu thích',
      data: fav,
    };
  }

  /**
   * Lấy danh sách món ăn yêu thích
   */
  async getFavoriteFoods(userId: string) {
    const favorites = await this.prisma.favoriteFood.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Lấy danh sách món yêu thích thành công',
      data: favorites.map((f) => f.foodName),
    };
  }

  /**
   * Bỏ món ăn khỏi danh sách yêu thích
   */
  async removeFavoriteFood(userId: string, foodName: string) {
    await this.prisma.favoriteFood.deleteMany({
      where: {
        userId,
        foodName,
      },
    });

    return {
      message: 'Đã bỏ món khỏi danh sách yêu thích',
    };
  }
}
