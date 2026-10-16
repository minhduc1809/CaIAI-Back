import { ExerciseCatalogService } from '../exercise-catalog/exercise-catalog.service';
import { BARCODE_NAME_OVERRIDES } from './barcode-name-overrides.data';
import { cfg } from '../system-config/config.holder';
import { parseServing, per100g, unitsOf } from '../food-catalog/food-units';
import { getPlanLimits } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { refundDaily, reserveDaily } from '../billing/daily-counter';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import {
  dayBoundsForKey,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import {
  BadRequestException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateCustomFoodDto,
  UpdateCustomFoodDto,
} from './dto/create-custom-food.dto';
import { Gender, GoalType, WorkoutLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_FOOD_CATEGORIES,
  FoodCatalogService,
} from '../food-catalog/food-catalog.service';
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly catalog?: FoodCatalogService,
    @Optional() private readonly exerciseCatalog?: ExerciseCatalogService,
  ) {}

  /**
   * Tra cứu danh sách các món ăn Việt Nam chuẩn Viện Dinh Dưỡng (hỗ trợ search và filter theo category)
   */
  async searchFoodItems(query?: string, category?: string) {
    // Tìm trong kho ở cơ sở dữ liệu (BR-08.1): không phân biệt dấu, có tên gọi khác, chịu gõ sai nhẹ. Hình dạng mỗi
    // món giữ như cũ để app không phải đổi.
    let results: SeedFoodItem[];
    if (this.catalog) {
      results = (await this.catalog.search(query, category)).map(
        ({ name, category: cat, servingSize, calories, protein, carb, fat, note, units }) => {
          const servingGrams = parseServing(servingSize).grams;
          return {
            name,
            category: cat,
            servingSize,
            calories,
            protein,
            carb,
            fat,
            ...(note ? { note } : {}),
            // BR-08.2: số gram của khẩu phần, các đơn vị chọn được và số liệu trên 100 g (thêm trường, không đổi trường cũ)
            servingGrams,
            units: unitsOf(servingSize, units),
            per100g: per100g(servingGrams, { calories, protein, carb, fat }),
          };
        },
      );
    } else {
      results = VIETNAMESE_FOODS_DATA;
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
    const categories = this.catalog
      ? await this.catalog.categories()
      : DEFAULT_FOOD_CATEGORIES;

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

    // Kho bài tập trong DB (admin sửa/ẩn được); không có thì dùng kho trong code
    const allExercises = this.exerciseCatalog
      ? await this.exerciseCatalog.getAll()
      : [...MALE_EXERCISES, ...FEMALE_EXERCISES];
    const exercisePool = allExercises.filter(
      (e) => e.genderTarget === targetGender || e.genderTarget === 'ALL',
    );

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
    const exercise = this.exerciseCatalog
      ? await this.exerciseCatalog.getById(exerciseId)
      : [...MALE_EXERCISES, ...FEMALE_EXERCISES].find((ex) => ex.id === exerciseId);

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
   * Kiểm tra Atwater (BR-08.4): cảnh báo mềm nếu calo lệch > 15% so với 4P + 4C + 9F
   */
  private checkAtwater(
    calories: number,
    protein: number,
    carb: number,
    fat: number,
  ): string[] {
    const warnings: string[] = [];
    const expected = 4 * protein + 4 * carb + 9 * fat;
    if (calories > 0 && expected > 0) {
      const diffPct = Math.abs(calories - expected) / calories;
      const warnPct = cfg('food.atwaterWarnPct');
      if (diffPct > warnPct / 100) {
        warnings.push(
          `Số liệu calo (${Math.round(calories)} kcal) lệch hơn ${warnPct}% so với tổng macro (${Math.round(expected)} kcal: 4·P + 4·C + 9·F). Vui lòng kiểm tra lại.`,
        );
      }
    }
    return warnings;
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

    if (
      totals.calories > 5000 ||
      totals.protein > 500 ||
      totals.carb > 500 ||
      totals.fat > 500
    ) {
      throw new BadRequestException(
        'Số liệu dinh dưỡng vượt ngưỡng an toàn (tối đa 5000 kcal, 500g protein/carb/fat)',
      );
    }

    const warnings = this.checkAtwater(
      totals.calories,
      totals.protein,
      totals.carb,
      totals.fat,
    );

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
        barcode: dto.barcode ?? null,
      },
    });

    return {
      message: 'Tạo món ăn riêng thành công',
      data: food,
      warnings,
    };
  }

  /**
   * Cập nhật món ăn riêng (BR-08.4)
   */
  async updateCustomFood(userId: string, id: string, dto: UpdateCustomFoodDto) {
    const existing = await this.prisma.customFood.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Không tìm thấy món ăn');
    }

    const hasIngredients = dto.ingredients && dto.ingredients.length > 0;
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
          calories:
            dto.calories !== undefined ? dto.calories : existing.calories,
          protein: dto.protein !== undefined ? dto.protein : existing.protein,
          carb: dto.carb !== undefined ? dto.carb : existing.carb,
          fat: dto.fat !== undefined ? dto.fat : existing.fat,
        };

    if (
      totals.calories > 5000 ||
      totals.protein > 500 ||
      totals.carb > 500 ||
      totals.fat > 500
    ) {
      throw new BadRequestException(
        'Số liệu dinh dưỡng vượt ngưỡng an toàn (tối đa 5000 kcal, 500g protein/carb/fat)',
      );
    }

    const warnings = this.checkAtwater(
      totals.calories,
      totals.protein,
      totals.carb,
      totals.fat,
    );

    const updated = await this.prisma.customFood.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name : existing.name,
        servingSize:
          dto.servingSize !== undefined
            ? dto.servingSize
            : existing.servingSize,
        servingAmount:
          dto.servingAmount !== undefined
            ? dto.servingAmount
            : existing.servingAmount,
        servingUnit:
          dto.servingUnit !== undefined
            ? dto.servingUnit
            : existing.servingUnit,
        barcode: dto.barcode !== undefined ? dto.barcode : existing.barcode,
        calories: totals.calories,
        protein: totals.protein,
        carb: totals.carb,
        fat: totals.fat,
        ingredients: hasIngredients
          ? (dto.ingredients as any)
          : dto.ingredients === null
            ? null
            : existing.ingredients,
      },
    });

    return {
      message: 'Cập nhật món ăn riêng thành công',
      data: updated,
      warnings,
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
      throw new NotFoundException('Không tìm thấy món ăn');
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
    // Món tự tạo của chính người dùng có mã vạch này thì ưu tiên, không tốn hạn mức (BR-08.6)
    const own = await this.prisma.customFood.findFirst({
      where: { userId, barcode },
      orderBy: { createdAt: 'desc' },
    });
    if (own) {
      return {
        message: 'Tra cứu mã vạch thành công',
        data: {
          barcode,
          name: own.name,
          brand: null,
          imageUrl: null,
          servingSize: own.servingSize || '1 phần',
          servingAmount: own.servingAmount ?? 1,
          servingUnit: own.servingUnit ?? 'PORTION',
          calories: own.calories,
          protein: own.protein,
          carb: own.carb,
          fat: own.fat,
          source: 'CUSTOM',
          customFoodId: own.id,
        },
      };
    }

    // Hạn mức theo gói (Free giới hạn số lượt/ngày); lượt không dùng được vì lỗi mạng sẽ được hoàn lại
    const limits = await getPlanLimits(this.prisma, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = resolveTimezone(user?.timezone);
    const date = todayKey(tz);
    const ok = await reserveDaily(
      this.prisma,
      userId,
      date,
      'barcodeLookups',
      limits.barcodePerDay,
    );
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
        `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?lc=vi&fields=product_name,product_name_vi,generic_name,generic_name_vi,brands,image_url,serving_size,nutriments`,
      );
      const json = await response.json();

      if (json.status !== 1 || !json.product) {
        // Không tìm thấy thì không tính hạn mức (BR-08.6)
        await refundDaily(this.prisma, userId, date, 'barcodeLookups');
        return {
          message: 'Không tìm thấy sản phẩm với mã vạch này',
          data: null,
          notFound: true,
        };
      }

      const product = json.product;
      const nutriments = product.nutriments || {};

      // OpenFoodFacts luôn cho nutriments theo 100g/100ml. Nhãn "serving_size" (vd "15 g") là khẩu phần
      // THẬT của sản phẩm — nếu đọc được số gram thì quy đổi số liệu về đúng khẩu phần đó, tránh hiển thị
      // "400 kcal · 15 g" (số kcal/100g ghép nhầm với nhãn khẩu phần 15g, sai lệch ~6-7 lần).
      const servingGrams = parseFloat(
        String(product.serving_size || '').match(/[\d.,]+/)?.[0]?.replace(',', '.') || '',
      );
      const hasServing = Number.isFinite(servingGrams) && servingGrams > 0;
      const ratio = hasServing ? servingGrams / 100 : 1;
      const round1 = (n: number) => Math.round(n * 10) / 10;

      return {
        message: 'Tra cứu mã vạch thành công',
        data: {
          barcode,
          name:
            BARCODE_NAME_OVERRIDES[barcode] ||
            product.product_name_vi ||
            product.generic_name_vi ||
            product.product_name ||
            product.generic_name ||
            'Sản phẩm không tên',
          brand: product.brands || null,
          imageUrl: product.image_url || null,
          servingSize: hasServing ? product.serving_size : '100g',
          servingAmount: hasServing ? servingGrams : 100,
          servingUnit: 'GRAM',
          calories: round1((nutriments['energy-kcal_100g'] || 0) * ratio),
          protein: round1((nutriments['proteins_100g'] || 0) * ratio),
          carb: round1((nutriments['carbohydrates_100g'] || 0) * ratio),
          fat: round1((nutriments['fat_100g'] || 0) * ratio),
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
  async addFavoriteFood(
    userId: string,
    foodName: string,
    sourceType?: 'CATALOG' | 'CUSTOM',
    sourceId?: string,
  ) {
    const identity = await this.resolveFavoriteIdentity(userId, foodName, sourceType, sourceId);
    const fav = await this.prisma.favoriteFood.upsert({
      where: {
        userId_foodName: {
          userId,
          foodName,
        },
      },
      // Yêu thích cũ chưa có định danh thì bổ sung khi người dùng thêm lại
      update: identity,
      create: {
        userId,
        foodName,
        ...identity,
      },
    });

    return {
      message: 'Đã thêm món vào danh sách yêu thích',
      data: fav,
    };
  }

  /**
   * Xác định món yêu thích là món nào (BR-08.3): theo mã app gửi, không có thì tra theo tên trong kho rồi món tự tạo
   * của chính người dùng. Không tra được thì giữ yêu thích theo tên như trước.
   */
  private async resolveFavoriteIdentity(
    userId: string,
    foodName: string,
    sourceType?: 'CATALOG' | 'CUSTOM',
    sourceId?: string,
  ): Promise<{ sourceType?: string; sourceId?: string }> {
    try {
      if (sourceType === 'CUSTOM' && sourceId) {
        const own = await this.prisma.customFood.findFirst({ where: { id: sourceId, userId }, select: { id: true } });
        if (own) return { sourceType: 'CUSTOM', sourceId: own.id };
      }
      if (this.catalog && (sourceType === 'CATALOG' || !sourceType)) {
        const hit = await this.catalog.findByIdOrName({ id: sourceType === 'CATALOG' ? sourceId : undefined, name: foodName });
        if (hit) return { sourceType: 'CATALOG', sourceId: hit.id };
      }
      const custom = await this.prisma.customFood.findFirst({ where: { userId, name: foodName }, select: { id: true } });
      if (custom) return { sourceType: 'CUSTOM', sourceId: custom.id };
    } catch {
      // Tra định danh là phần thêm; lỗi thì vẫn lưu yêu thích theo tên
    }
    return {};
  }

  /**
   * Lấy danh sách món ăn yêu thích. Tên trả về là tên HIỆN TẠI của món (đổi tên trong kho/món tự tạo không làm mất
   * yêu thích); món cũ chưa có định danh giữ nguyên tên đã lưu.
   */
  async getFavoriteFoods(userId: string) {
    const favorites = await this.prisma.favoriteFood.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const customIds = favorites.filter((f) => f.sourceType === 'CUSTOM' && f.sourceId).map((f) => f.sourceId!);
    const customNames = new Map<string, string>();
    if (customIds.length > 0) {
      const rows = await this.prisma.customFood.findMany({ where: { userId, id: { in: customIds } }, select: { id: true, name: true } });
      rows.forEach((r) => customNames.set(r.id, r.name));
    }
    const names: string[] = [];
    for (const f of favorites) {
      let name = f.foodName;
      if (f.sourceType === 'CATALOG' && f.sourceId && this.catalog) {
        name = (await this.catalog.findByIdOrName({ id: f.sourceId }))?.name ?? name;
      } else if (f.sourceType === 'CUSTOM' && f.sourceId) {
        name = customNames.get(f.sourceId) ?? name;
      }
      if (!names.includes(name)) names.push(name);
    }

    return {
      message: 'Lấy danh sách món yêu thích thành công',
      data: names,
    };
  }

  /**
   * Bỏ món ăn khỏi danh sách yêu thích
   */
  async removeFavoriteFood(userId: string, foodName: string) {
    // Bỏ theo tên đang hiển thị: gồm cả yêu thích lưu tên cũ nhưng cùng một món (cùng định danh)
    const identity = await this.resolveFavoriteIdentity(userId, foodName);
    await this.prisma.favoriteFood.deleteMany({
      where: {
        userId,
        OR: [
          { foodName },
          ...(identity.sourceType && identity.sourceId
            ? [{ sourceType: identity.sourceType, sourceId: identity.sourceId }]
            : []),
        ],
      },
    });

    return {
      message: 'Đã bỏ món khỏi danh sách yêu thích',
    };
  }
}
