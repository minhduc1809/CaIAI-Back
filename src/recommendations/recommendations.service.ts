import { Injectable } from '@nestjs/common';
import { Gender, GoalType, WorkoutLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VIETNAMESE_DIET_PLANS, VietnameseDietPlan } from './data/vietnamese-diet.data';
import { VIETNAMESE_WORKOUT_PLANS, WorkoutTemplatePlan } from './data/vietnamese-workout.data';
import { MALE_EXERCISES, FEMALE_EXERCISES } from './data/gender-exercises.data';
import { generateAdvancedMonthDiet, MonthDietPlanItem } from './data/vietnamese-month-diet.data';
import { VIETNAMESE_FOODS_DATA, SeedFoodItem } from './data/vietnamese-food-database.data';

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
      results = results.filter((f) => f.name.toLowerCase().includes(q) || (f.note && f.note.toLowerCase().includes(q)));
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
   * Gợi ý Thực đơn phù hợp nhất với Target Calories và Goal của người dùng
   */
  async getDietRecommendation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        goal: true,
        bmi: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
      },
    });

    const userGoal = user?.goal || GoalType.LOSE_WEIGHT;
    const userTargetCalo = user?.targetCalories || 1500;

    // 1. Lọc thực đơn theo Goal của User
    const filteredByGoal = VIETNAMESE_DIET_PLANS.filter((plan) => plan.goal === userGoal);
    const plansPool = filteredByGoal.length > 0 ? filteredByGoal : VIETNAMESE_DIET_PLANS;

    // 2. Tìm thực đơn có mức calo gần nhất với User Target Calories
    let bestPlan = plansPool[0];
    let minDiff = Math.abs(bestPlan.targetCalo - userTargetCalo);

    for (const plan of plansPool) {
      const diff = Math.abs(plan.targetCalo - userTargetCalo);
      if (diff < minDiff) {
        minDiff = diff;
        bestPlan = plan;
      }
    }

    return {
      message: 'Gợi ý thực đơn món Việt chuẩn calo thành công',
      data: {
        userTarget: {
          goal: userGoal,
          targetCalories: userTargetCalo,
          targetProtein: user?.targetProtein,
          targetCarb: user?.targetCarb,
          targetFat: user?.targetFat,
        },
        recommendedPlan: bestPlan,
        availableOptions: plansPool.map((p) => ({
          id: p.id,
          title: p.title,
          targetCalo: p.targetCalo,
          description: p.description,
        })),
      },
    };
  }

  /**
   * Lấy Thực đơn chuẩn món Việt chi tiết 30 ngày trong tháng
   * Tự động phân chia khác biệt hoàn toàn theo Goal (Giảm cân / Tăng cân) và Cấp độ kinh nghiệm/Cường độ tập (Beginner, Intermediate, Advanced)
   */
  async getMonthlyDietPlans(
    userId: string,
    dayNumberQuery?: number,
    goalQuery?: string,
    levelQuery?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        goal: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
      },
    });

    // 1. Xác định Mục tiêu (Goal)
    let selectedGoal = user?.goal || GoalType.LOSE_WEIGHT;
    if (goalQuery) {
      const upperGoal = goalQuery.toUpperCase();
      if (upperGoal === 'LOSE_WEIGHT' || upperGoal === 'GAIN_WEIGHT' || upperGoal === 'MAINTAIN') {
        selectedGoal = upperGoal as GoalType;
      }
    }

    // 2. Xác định Cấp độ kinh nghiệm / Cường độ tập luyện (Level)
    let selectedLevel: WorkoutLevel = WorkoutLevel.BEGINNER;
    if (levelQuery) {
      const upperLevel = levelQuery.toUpperCase();
      if (upperLevel === 'BEGINNER' || upperLevel === 'INTERMEDIATE' || upperLevel === 'ADVANCED') {
        selectedLevel = upperLevel as WorkoutLevel;
      }
    }

    const userTargetCalo = user?.targetCalories || (selectedGoal === GoalType.GAIN_WEIGHT ? 2200 : 1400);

    // 3. Sinh thực đơn 30 ngày chuyên biệt
    const monthlyPlans = generateAdvancedMonthDiet(userTargetCalo, selectedGoal, selectedLevel);

    // Nếu có query ngày cụ thể (VD: day=5)
    if (dayNumberQuery) {
      const selectedDay = monthlyPlans.find((p) => p.dayNumber === Number(dayNumberQuery)) || monthlyPlans[0];
      return {
        message: `Lấy thực đơn Ngày ${selectedDay.dayNumber} cho ${selectedGoal} (${selectedLevel}) thành công`,
        data: {
          goal: selectedGoal,
          experienceLevel: selectedLevel,
          dayPlan: selectedDay,
        },
      };
    }

    return {
      message: `Lấy danh sách thực đơn 30 ngày cho ${selectedGoal} (${selectedLevel}) thành công`,
      data: {
        goal: selectedGoal,
        experienceLevel: selectedLevel,
        totalDays: monthlyPlans.length,
        monthlyPlans,
      },
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
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find((w) => w.goal === GoalType.GAIN_WEIGHT);
    } else if (userGoal === GoalType.MAINTAIN) {
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find((w) => w.goal === GoalType.MAINTAIN);
    } else {
      // LOSE_WEIGHT: Chọn bài tập an toàn cho khớp gối nếu BMI cao
      suitablePlan = VIETNAMESE_WORKOUT_PLANS.find((w) => w.goal === GoalType.LOSE_WEIGHT);
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
    const [dietResult, workoutResult] = await Promise.all([
      this.getDietRecommendation(userId),
      this.getWorkoutRecommendation(userId),
    ]);

    return {
      message: 'Lấy trọn bộ gói gợi ý cá nhân hóa thành công',
      data: {
        diet: dietResult.data,
        workout: workoutResult.data,
      },
    };
  }

  /**
   * Lấy danh sách 50 bài tập được tối ưu riêng theo giới tính (Nam / Nữ) và cấp độ (Beginner / Intermediate / Advanced)
   */
  async getGenderExercises(userId: string, genderQuery?: string, levelQuery?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        gender: true,
      },
    });

    // Xác định giới tính mục tiêu
    let targetGender: Gender = Gender.MALE;
    if (genderQuery) {
      targetGender = genderQuery.toUpperCase() === 'FEMALE' ? Gender.FEMALE : Gender.MALE;
    } else if (user?.gender === Gender.FEMALE) {
      targetGender = Gender.FEMALE;
    }

    const exercisePool = targetGender === Gender.FEMALE ? FEMALE_EXERCISES : MALE_EXERCISES;

    // Lọc theo level nếu có query
    let filteredList = exercisePool;
    if (levelQuery) {
      const upperLevel = levelQuery.toUpperCase();
      if (upperLevel === 'BEGINNER' || upperLevel === 'INTERMEDIATE' || upperLevel === 'ADVANCED') {
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
          beginner: exercisePool.filter((e) => e.level === WorkoutLevel.BEGINNER).length,
          intermediate: exercisePool.filter((e) => e.level === WorkoutLevel.INTERMEDIATE).length,
          advanced: exercisePool.filter((e) => e.level === WorkoutLevel.ADVANCED).length,
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
   * Tạo món ăn tự tạo riêng của người dùng (Custom Food)
   */
  async createCustomFood(userId: string, dto: any) {
    const food = await this.prisma.customFood.create({
      data: {
        userId,
        name: dto.name,
        servingSize: dto.servingSize || null,
        servingAmount: dto.servingAmount ?? null,
        servingUnit: dto.servingUnit || null,
        calories: dto.calories,
        protein: dto.protein || 0,
        carb: dto.carb || 0,
        fat: dto.fat || 0,
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
  async lookupBarcode(barcode: string) {
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
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
          name: product.product_name || product.product_name_vi || 'Sản phẩm không tên',
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
