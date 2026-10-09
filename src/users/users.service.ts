import { isFreeTierLimited } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { startGoal } from './goal.util';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  TargetChangeSource,
  PregnancyStatus,
  GoalType,
  Gender,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  HealthCalculatorService,
  HealthMetricsInput,
  activityLevelFromTrainingDays,
  sessionsBucketFromTrainingDays,
} from './health-calculator.service';
import { AdaptiveExpenditureService } from './adaptive-expenditure.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveOnboardingDraftDto } from './dto/onboarding-draft.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthCalculator: HealthCalculatorService,
    private readonly adaptiveExpenditure: AdaptiveExpenditureService,
  ) {}

  /**
   * Lấy thông tin cá nhân của người dùng đang đăng nhập
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        authProvider: true,
        isEmailVerified: true,
        gender: true,
        pregnancyStatus: true,
        dateOfBirth: true,
        heightCm: true,
        weightKg: true,
        targetWeightKg: true,
        weightRateKgPerWeek: true,
        weightRatePercent: true,
        onboardingDraft: true,
        bodyFatPercent: true,
        activityLevel: true,
        goal: true,
        macroStyle: true,
        bmi: true,
        bmr: true,
        tdee: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        targetLimitedBy: true,
        adaptiveExpenditure: true,
        expenditureStatus: true,
        sleepHours: true,
        stressLevel: true,
        takesSupplements: true,
        dietType: true,
        mealsPerDay: true,
        cookTimeMinutes: true,
        foodBudgetLevel: true,
        trainingExperience: true,
        trainingGoal: true,
        sessionsPerWeek: true,
        trainingDaysPerWeek: true,
        equipmentAccess: true,
        injuries: true,
        allergies: true,
        injuriesOtherNote: true,
        oneRepMaxSquatKg: true,
        oneRepMaxBenchKg: true,
        oneRepMaxDeadliftKg: true,
        programType: true,
        proteinPreference: true,
        isIntermittentFasting: true,
        ifWindowStart: true,
        ifWindowEnd: true,
        dailyAiQuota: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return {
      message: 'Lấy thông tin người dùng thành công',
      data: user,
    };
  }

  /**
   * Cập nhật thông số cơ thể và tự động tính toán lại BMI/BMR/TDEE/Macros
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // 1. Lấy thông tin user hiện tại
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    // 2. Gom các thông số mới (hoặc giữ lại thông số cũ nếu không truyền)
    const heightCm =
      dto.heightCm !== undefined ? dto.heightCm : currentUser.heightCm;
    const weightKg =
      dto.weightKg !== undefined ? dto.weightKg : currentUser.weightKg;
    const bodyFatPercent =
      dto.bodyFatPercent !== undefined
        ? dto.bodyFatPercent
        : currentUser.bodyFatPercent;
    const dateOfBirth =
      dto.dateOfBirth !== undefined
        ? dto.dateOfBirth
          ? new Date(dto.dateOfBirth)
          : null
        : currentUser.dateOfBirth;
    const gender = dto.gender !== undefined ? dto.gender : currentUser.gender;

    // Kiểm tra độ tuổi (BR-02.2)
    if (dateOfBirth) {
      const today = new Date();
      let age = today.getFullYear() - dateOfBirth.getFullYear();
      const monthDiff = today.getMonth() - dateOfBirth.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())
      ) {
        age--;
      }
      if (age < 18) {
        throw new BadRequestException(
          'Người dùng phải từ đủ 18 tuổi trở lên để sử dụng ứng dụng.',
        );
      }
      if (age > 100) {
        throw new BadRequestException('Ngày sinh không hợp lệ.');
      }
    }

    const goal = dto.goal !== undefined ? dto.goal : currentUser.goal;

    // Kiểm tra mang thai / cho con bú (BR-02.2)
    const pregnancyStatus =
      dto.pregnancyStatus !== undefined
        ? dto.pregnancyStatus
        : currentUser.pregnancyStatus;

    if (pregnancyStatus && pregnancyStatus !== PregnancyStatus.NONE) {
      if (gender === Gender.MALE) {
        throw new BadRequestException(
          'Chỉ người dùng nữ mới có thể thiết lập trạng thái mang thai hoặc cho con bú.',
        );
      }
      if (goal === GoalType.LOSE_WEIGHT) {
        throw new BadRequestException(
          'Phụ nữ mang thai hoặc đang cho con bú không được phép áp dụng chế độ giảm cân thâm hụt calo.',
        );
      }
    }

    // Kiểm tra cân đích bắt buộc và đúng chiều (BR-02.3)
    let targetWeightKg =
      dto.targetWeightKg !== undefined
        ? dto.targetWeightKg
        : currentUser.targetWeightKg;

    if (goal === GoalType.LOSE_WEIGHT) {
      if (
        !targetWeightKg &&
        (dto.goal !== undefined ||
          !currentUser.targetCalories ||
          dto.applyTarget)
      ) {
        throw new BadRequestException(
          'Cân nặng mục tiêu là bắt buộc khi chọn mục tiêu giảm cân.',
        );
      }
      if (
        weightKg &&
        targetWeightKg &&
        targetWeightKg >= weightKg &&
        dto.targetWeightKg !== undefined
      ) {
        throw new BadRequestException(
          'Cân nặng mục tiêu phải nhỏ hơn cân nặng hiện tại khi giảm cân.',
        );
      }
    } else if (goal === GoalType.GAIN_WEIGHT) {
      if (
        !targetWeightKg &&
        (dto.goal !== undefined ||
          !currentUser.targetCalories ||
          dto.applyTarget)
      ) {
        throw new BadRequestException(
          'Cân nặng mục tiêu là bắt buộc khi chọn mục tiêu tăng cân.',
        );
      }
      if (
        weightKg &&
        targetWeightKg &&
        targetWeightKg <= weightKg &&
        dto.targetWeightKg !== undefined
      ) {
        throw new BadRequestException(
          'Cân nặng mục tiêu phải lớn hơn cân nặng hiện tại khi tăng cân.',
        );
      }
    } else if (goal === GoalType.MAINTAIN && !targetWeightKg && weightKg) {
      targetWeightKg = weightKg;
    }

    // Tính tốc độ theo % cân nặng và kiểm tra trần an toàn (BR-02.3)
    let weightRateKgPerWeek =
      dto.weightRateKgPerWeek !== undefined
        ? dto.weightRateKgPerWeek
        : currentUser.weightRateKgPerWeek;

    let weightRatePercent =
      dto.weightRatePercent !== undefined
        ? dto.weightRatePercent
        : currentUser.weightRatePercent;

    if (dto.weightRatePercent !== undefined && weightKg && weightKg > 0) {
      weightRateKgPerWeek =
        Math.round(((dto.weightRatePercent * weightKg) / 100) * 100) / 100;
    } else if (weightRateKgPerWeek && weightKg && weightKg > 0) {
      weightRatePercent =
        Math.round((weightRateKgPerWeek / weightKg) * 100 * 100) / 100;
    }

    if (
      goal === GoalType.LOSE_WEIGHT &&
      weightRateKgPerWeek &&
      weightKg &&
      weightKg > 0 &&
      (dto.weightRateKgPerWeek !== undefined ||
        dto.weightRatePercent !== undefined)
    ) {
      const pct = (weightRateKgPerWeek / weightKg) * 100;
      const bmi = heightCm ? weightKg / Math.pow(heightCm / 100, 2) : 22;
      const maxSafePct = bmi >= 30 ? 1.5 : 1.0;
      if (pct > maxSafePct + 0.05) {
        throw new BadRequestException(
          'Tốc độ giảm cân vượt quá giới hạn an toàn (> 1% cân nặng/tuần), có nguy cơ mất cơ bắp.',
        );
      }
    }

    // BR-03.2 / BR-03.6: số buổi tập là nguồn duy nhất để suy ra mức vận động và nhóm buổi tập
    const trainingDaysPerWeek =
      dto.trainingDaysPerWeek !== undefined
        ? dto.trainingDaysPerWeek
        : currentUser.trainingDaysPerWeek;
    const activityLevel =
      dto.trainingDaysPerWeek !== undefined
        ? activityLevelFromTrainingDays(dto.trainingDaysPerWeek)
        : dto.activityLevel !== undefined
          ? dto.activityLevel
          : currentUser.activityLevel;
    const macroStyle =
      dto.macroStyle !== undefined ? dto.macroStyle : currentUser.macroStyle;
    const proteinPreference =
      dto.proteinPreference !== undefined
        ? dto.proteinPreference
        : currentUser.proteinPreference;

    // 3. Tính chỉ số (TDEE tĩnh làm baseline, rồi Expenditure thích ứng nếu đã đủ dữ liệu)
    const { calculations, expenditureResult } = await this.computeCalculations(
      userId,
      {
        heightCm,
        weightKg,
        targetWeightKg,
        weightRateKgPerWeek,
        weightRatePercent,
        bodyFatPercent,
        dateOfBirth,
        gender,
        pregnancyStatus,
        activityLevel,
        goal,
        macroStyle,
        proteinPreference,
      },
    );

    // BR-04: mục tiêu chỉ đổi khi user xác nhận (applyTarget) hoặc khi chưa từng có mục tiêu
    // (hoàn tất Onboarding). Các trường hợp khác chỉ trả về proposedTarget.
    const hadTarget = currentUser.targetCalories != null;
    const canCompute = calculations.targetCalories != null;
    const applyTarget = canCompute && (dto.applyTarget === true || !hadTarget);
    const goalChanged =
      (dto.goal !== undefined && dto.goal !== currentUser.goal) ||
      (dto.targetWeightKg !== undefined &&
        dto.targetWeightKg !== currentUser.targetWeightKg) ||
      (dto.weightRateKgPerWeek !== undefined &&
        dto.weightRateKgPerWeek !== currentUser.weightRateKgPerWeek);
    const source: TargetChangeSource = !hadTarget
      ? TargetChangeSource.ONBOARDING
      : goalChanged
        ? TargetChangeSource.GOAL_CHANGE
        : TargetChangeSource.PROFILE_RECALC;

    // 4. Cập nhật vào Database
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name !== undefined ? dto.name : currentUser.name,
        avatar: dto.avatar !== undefined ? dto.avatar : currentUser.avatar,
        gender,
        pregnancyStatus,
        dateOfBirth,
        heightCm,
        weightKg,
        targetWeightKg,
        weightRateKgPerWeek,
        weightRatePercent,
        bodyFatPercent,
        activityLevel,
        goal,
        macroStyle: calculations.macroStyle,
        timezone:
          dto.timezone !== undefined ? dto.timezone : currentUser.timezone,
        sleepHours:
          dto.sleepHours !== undefined
            ? dto.sleepHours
            : currentUser.sleepHours,
        stressLevel:
          dto.stressLevel !== undefined
            ? dto.stressLevel
            : currentUser.stressLevel,
        takesSupplements:
          dto.takesSupplements !== undefined
            ? dto.takesSupplements
            : currentUser.takesSupplements,
        dietType:
          dto.dietType !== undefined ? dto.dietType : currentUser.dietType,
        mealsPerDay:
          dto.mealsPerDay !== undefined
            ? dto.mealsPerDay
            : currentUser.mealsPerDay,
        cookTimeMinutes:
          dto.cookTimeMinutes !== undefined
            ? dto.cookTimeMinutes
            : currentUser.cookTimeMinutes,
        foodBudgetLevel:
          dto.foodBudgetLevel !== undefined
            ? dto.foodBudgetLevel
            : currentUser.foodBudgetLevel,
        trainingExperience:
          dto.trainingExperience !== undefined
            ? dto.trainingExperience
            : currentUser.trainingExperience,
        trainingGoal:
          dto.trainingGoal !== undefined
            ? dto.trainingGoal
            : currentUser.trainingGoal,
        trainingDaysPerWeek,
        sessionsPerWeek:
          dto.trainingDaysPerWeek !== undefined
            ? sessionsBucketFromTrainingDays(dto.trainingDaysPerWeek)
            : dto.sessionsPerWeek !== undefined
              ? dto.sessionsPerWeek
              : currentUser.sessionsPerWeek,
        equipmentAccess:
          dto.equipmentAccess !== undefined
            ? dto.equipmentAccess
            : currentUser.equipmentAccess,
        injuries:
          dto.injuries !== undefined ? dto.injuries : currentUser.injuries,
        allergies:
          dto.allergies !== undefined ? dto.allergies : currentUser.allergies,
        injuriesOtherNote:
          dto.injuriesOtherNote !== undefined
            ? dto.injuriesOtherNote
            : currentUser.injuriesOtherNote,
        oneRepMaxSquatKg:
          dto.oneRepMaxSquatKg !== undefined
            ? dto.oneRepMaxSquatKg
            : currentUser.oneRepMaxSquatKg,
        oneRepMaxBenchKg:
          dto.oneRepMaxBenchKg !== undefined
            ? dto.oneRepMaxBenchKg
            : currentUser.oneRepMaxBenchKg,
        oneRepMaxDeadliftKg:
          dto.oneRepMaxDeadliftKg !== undefined
            ? dto.oneRepMaxDeadliftKg
            : currentUser.oneRepMaxDeadliftKg,
        programType:
          dto.programType !== undefined
            ? dto.programType
            : currentUser.programType,
        proteinPreference:
          dto.proteinPreference !== undefined
            ? dto.proteinPreference
            : currentUser.proteinPreference,
        isIntermittentFasting:
          dto.isIntermittentFasting !== undefined
            ? dto.isIntermittentFasting
            : currentUser.isIntermittentFasting,
        ifWindowStart:
          dto.ifWindowStart !== undefined
            ? dto.ifWindowStart
            : currentUser.ifWindowStart,
        ifWindowEnd:
          dto.ifWindowEnd !== undefined
            ? dto.ifWindowEnd
            : currentUser.ifWindowEnd,
        // Các chỉ số tính toán
        bmi: calculations.bmi,
        bmr: calculations.bmr,
        tdee: calculations.tdee,
        ...(applyTarget
          ? {
              targetCalories: calculations.targetCalories,
              targetProtein: calculations.targetProtein,
              targetCarb: calculations.targetCarb,
              targetFat: calculations.targetFat,
              targetLimitedBy: calculations.targetLimitedBy,
              onboardingDraft: Prisma.DbNull,
            }
          : {}),
        adaptiveExpenditure: expenditureResult.estimatedExpenditure,
        expenditureStatus: expenditureResult.status,
        expenditureUpdatedAt: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        authProvider: true,
        isEmailVerified: true,
        gender: true,
        dateOfBirth: true,
        heightCm: true,
        weightKg: true,
        targetWeightKg: true,
        weightRateKgPerWeek: true,
        bodyFatPercent: true,
        activityLevel: true,
        goal: true,
        macroStyle: true,
        bmi: true,
        bmr: true,
        tdee: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        targetLimitedBy: true,
        adaptiveExpenditure: true,
        expenditureStatus: true,
        sleepHours: true,
        stressLevel: true,
        takesSupplements: true,
        dietType: true,
        mealsPerDay: true,
        cookTimeMinutes: true,
        foodBudgetLevel: true,
        trainingExperience: true,
        trainingGoal: true,
        sessionsPerWeek: true,
        trainingDaysPerWeek: true,
        equipmentAccess: true,
        injuries: true,
        allergies: true,
        injuriesOtherNote: true,
        oneRepMaxSquatKg: true,
        oneRepMaxBenchKg: true,
        oneRepMaxDeadliftKg: true,
        programType: true,
        proteinPreference: true,
        isIntermittentFasting: true,
        ifWindowStart: true,
        ifWindowEnd: true,
        dailyAiQuota: true,
        timezone: true,
        updatedAt: true,
      },
    });

    await this.adaptiveExpenditure.recordSnapshot(userId, expenditureResult);

    if (applyTarget) {
      await this.recordTargetChangeIfChanged(
        userId,
        source,
        {
          calories: currentUser.targetCalories,
          protein: currentUser.targetProtein,
          carb: currentUser.targetCarb,
          fat: currentUser.targetFat,
        },
        {
          calories: calculations.targetCalories,
          protein: calculations.targetProtein,
          carb: calculations.targetCarb,
          fat: calculations.targetFat,
        },
        !hadTarget,
      );
    }

    // BR-09.5: hoàn tất Onboarding hoặc đổi loại mục tiêu/cân đích thì bắt đầu Goal mới (tiến độ tính lại từ cân lúc này).
    // Đổi tốc độ không tạo Goal mới vì không đổi đích đến.
    const goalTypeChanged =
      dto.goal !== undefined && dto.goal !== currentUser.goal;
    const targetWeightChanged =
      dto.targetWeightKg !== undefined &&
      dto.targetWeightKg !== currentUser.targetWeightKg;
    if (
      goal &&
      weightKg &&
      (!hadTarget || goalTypeChanged || targetWeightChanged)
    ) {
      await startGoal(this.prisma, userId, {
        goalType: goal,
        startWeight: weightKg,
        targetWeight: targetWeightKg,
        rateKgPerWeek: weightRateKgPerWeek,
      });
    }

    const proposedTarget = applyTarget
      ? null
      : this.buildProposedTarget(currentUser, calculations);

    // 5. Nếu có cập nhật cân nặng mới, tự động ghi 1 dòng vào WeightLog để vẽ biểu đồ
    if (dto.weightKg && dto.weightKg !== currentUser.weightKg) {
      await this.prisma.weightLog.create({
        data: {
          userId,
          weightKg: dto.weightKg,
          note: 'Cập nhật từ hồ sơ người dùng',
        },
      });
    }

    return {
      message: 'Cập nhật thông tin và tính toán chỉ số sức khỏe thành công',
      data: {
        ...updatedUser,
        bmiClassification: calculations.bmiClassification,
        bmrFormula: calculations.bmrFormula,
        expenditureMessage: expenditureResult.message,
        targetApplied: applyTarget,
        proposedTarget,
      },
    };
  }

  /**
   * Tính TDEE tĩnh, chạy Adaptive Engine, rồi tính mục tiêu (ưu tiên Expenditure thích ứng nếu có).
   */
  private async computeCalculations(
    userId: string,
    profile: HealthMetricsInput,
  ) {
    const staticCalculations =
      this.healthCalculator.calculateAllMetrics(profile);
    const expenditureResult = await this.adaptiveExpenditure.recalculate(
      userId,
      staticCalculations.tdee,
    );
    const calculations = this.healthCalculator.calculateAllMetrics({
      ...profile,
      expenditureOverride:
        expenditureResult.method === 'ADAPTIVE'
          ? expenditureResult.estimatedExpenditure
          : null,
    });
    return { calculations, expenditureResult };
  }

  /** Mục tiêu đề xuất kèm chênh lệch so với mục tiêu đang dùng; null nếu không có gì khác. */
  private buildProposedTarget(
    current: {
      targetCalories: number | null;
      targetProtein: number | null;
      targetCarb: number | null;
      targetFat: number | null;
    },
    calc: {
      targetCalories: number | null;
      targetProtein: number | null;
      targetCarb: number | null;
      targetFat: number | null;
    },
  ) {
    if (calc.targetCalories == null) return null;
    const same =
      current.targetCalories === calc.targetCalories &&
      current.targetProtein === calc.targetProtein &&
      current.targetCarb === calc.targetCarb &&
      current.targetFat === calc.targetFat;
    if (same) return null;
    return {
      calories: calc.targetCalories,
      protein: calc.targetProtein,
      carb: calc.targetCarb,
      fat: calc.targetFat,
      diff: {
        calories: calc.targetCalories - (current.targetCalories ?? 0),
        protein: (calc.targetProtein ?? 0) - (current.targetProtein ?? 0),
        carb: (calc.targetCarb ?? 0) - (current.targetCarb ?? 0),
        fat: (calc.targetFat ?? 0) - (current.targetFat ?? 0),
      },
    };
  }

  /** Ghi một dòng TargetChange khi mục tiêu thực sự thay đổi (hoặc lần đầu đặt mục tiêu). */
  private async recordTargetChangeIfChanged(
    userId: string,
    source: TargetChangeSource,
    before: {
      calories: number | null;
      protein: number | null;
      carb: number | null;
      fat: number | null;
    },
    after: {
      calories: number | null;
      protein: number | null;
      carb: number | null;
      fat: number | null;
    },
    force = false,
  ) {
    const changed =
      before.calories !== after.calories ||
      before.protein !== after.protein ||
      before.carb !== after.carb ||
      before.fat !== after.fat;
    if (!changed && !force) return;
    await this.prisma.targetChange.create({
      data: {
        userId,
        source,
        oldCalories: before.calories,
        newCalories: after.calories,
        oldMacros: {
          protein: before.protein,
          carb: before.carb,
          fat: before.fat,
        },
        newMacros: { protein: after.protein, carb: after.carb, fat: after.fat },
      },
    });
  }

  /**
   * BR-04 sự kiện E5: user xem mục tiêu đề xuất sau khi đổi hồ sơ và bấm "Áp dụng".
   */
  async applyProposedTarget(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const { calculations } = await this.computeCalculations(userId, {
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      targetWeightKg: user.targetWeightKg,
      weightRateKgPerWeek: user.weightRateKgPerWeek,
      bodyFatPercent: user.bodyFatPercent,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: user.goal,
      macroStyle: user.macroStyle,
    });

    if (calculations.targetCalories == null) {
      throw new BadRequestException(
        'Chưa đủ thông tin hồ sơ (chiều cao, cân nặng, ngày sinh, giới tính) để tính mục tiêu',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        targetCalories: calculations.targetCalories,
        targetProtein: calculations.targetProtein,
        targetCarb: calculations.targetCarb,
        targetFat: calculations.targetFat,
        targetLimitedBy: calculations.targetLimitedBy,
      },
      select: {
        targetCalories: true,
        targetLimitedBy: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
      },
    });

    await this.recordTargetChangeIfChanged(
      userId,
      TargetChangeSource.PROFILE_RECALC,
      {
        calories: user.targetCalories,
        protein: user.targetProtein,
        carb: user.targetCarb,
        fat: user.targetFat,
      },
      {
        calories: updated.targetCalories,
        protein: updated.targetProtein,
        carb: updated.targetCarb,
        fat: updated.targetFat,
      },
    );

    return { message: 'Đã áp dụng mục tiêu mới', data: updated };
  }

  /** Lịch sử thay đổi mục tiêu, mới nhất trước. */
  async getTargetHistory(userId: string, limit = 50) {
    const items = await this.prisma.targetChange.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit > 0 ? limit : 50,
    });
    return { message: 'Lấy lịch sử mục tiêu thành công', data: items };
  }

  /**
   * Xem chi tiết trạng thái Adaptive Expenditure Engine kèm hướng dẫn đọc hiểu (BRD: Expenditure Page)
   */
  async getExpenditureStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const staticCalculations = this.healthCalculator.calculateAllMetrics({
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      targetWeightKg: user.targetWeightKg,
      weightRateKgPerWeek: user.weightRateKgPerWeek,
      bodyFatPercent: user.bodyFatPercent,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: user.goal,
      macroStyle: user.macroStyle,
    });

    const expenditureResult = await this.adaptiveExpenditure.recalculate(
      userId,
      staticCalculations.tdee,
    );

    return {
      message: 'Lấy trạng thái Expenditure thành công',
      data: expenditureResult,
    };
  }

  async getExpenditureHistory(userId: string, limit?: number) {
    const history = await this.adaptiveExpenditure.getHistory(
      userId,
      limit && limit > 0 ? limit : undefined,
    );
    // Free chỉ xem lịch sử 7 ngày gần nhất (đặc tả 2.8); Premium xem đầy đủ. Chỉ áp dụng khi BILLING_ENFORCE=true.
    const windowDays = (await isFreeTierLimited(this.prisma, userId))
      ? PLAN_LIMITS.FREE.expenditureHistoryDays
      : null;
    const visible = windowDays
      ? history.filter(
          (h) =>
            h.recordedAt.getTime() >=
            Date.now() - windowDays * 24 * 60 * 60 * 1000,
        )
      : history;
    return {
      message: 'Lấy lịch sử Expenditure thành công',
      data: visible,
      limitedToDays: windowDays,
    };
  }

  /**
   * Báo cáo tổng quan phân tích thể trạng và chỉ số dinh dưỡng
   */
  async getHealthSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const calculations = this.healthCalculator.calculateAllMetrics({
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      targetWeightKg: user.targetWeightKg,
      weightRateKgPerWeek: user.weightRateKgPerWeek,
      bodyFatPercent: user.bodyFatPercent,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: user.goal,
      macroStyle: user.macroStyle,
    });

    return {
      message: 'Lấy báo cáo phân tích thể trạng thành công',
      data: {
        userId: user.id,
        username: user.username,
        name: user.name,
        currentStats: {
          heightCm: user.heightCm,
          weightKg: user.weightKg,
          targetWeightKg: user.targetWeightKg,
          weightRateKgPerWeek: user.weightRateKgPerWeek,
          bodyFatPercent: user.bodyFatPercent,
          gender: user.gender,
          goal: user.goal,
          macroStyle: user.macroStyle,
          activityLevel: user.activityLevel,
        },
        metrics: calculations,
        adaptiveExpenditure: user.adaptiveExpenditure,
        expenditureStatus: user.expenditureStatus,
        advice: this.generateQuickHealthAdvice(user.goal, calculations.bmi),
      },
    };
  }

  private generateQuickHealthAdvice(
    goal: string | null,
    bmi: number | null,
  ): string {
    if (!bmi) {
      return 'Vui lòng cập nhật đầy đủ chiều cao và cân nặng để nhận được lời khuyên cá nhân hóa.';
    }
    if (goal === 'LOSE_WEIGHT') {
      return 'Để giảm cân hiệu quả và an toàn, hãy duy trì mức thâm hụt calo đều đặn, ưu tiên nạp đủ đạm (protein) để giữ cơ bắp và kết hợp cardio 3-4 buổi/tuần.';
    }
    if (goal === 'GAIN_WEIGHT') {
      return 'Để tăng cân / tăng cơ lành mạnh, hãy nạp dư thừa calo sạch từ nguồn tinh bột phức, thịt nạc, trứng, sữa và kết hợp tập kháng lực (Gym/Kháng lực).';
    }
    return 'Duy trì năng lượng nạp vào tương đương năng lượng tiêu hao (TDEE) để giữ cân nặng và vóc dáng ổn định.';
  }

  /**
   * Lấy dữ liệu nháp Onboarding (BR-02.4).
   */
  async getOnboardingDraft(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingDraft: true },
    });
    return {
      message: 'Lấy dữ liệu nháp Onboarding thành công',
      data: user?.onboardingDraft ?? null,
    };
  }

  /**
   * Lưu tiến độ nháp Onboarding (BR-02.4).
   */
  async saveOnboardingDraft(userId: string, dto: SaveOnboardingDraftDto) {
    const draftPayload = {
      step: dto.step,
      data: dto.data,
      updatedAt: new Date().toISOString(),
    };
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingDraft: draftPayload },
    });
    return {
      message: 'Lưu nháp Onboarding thành công',
      data: draftPayload,
    };
  }

  /**
   * Xóa dữ liệu nháp Onboarding (BR-02.4).
   */
  async clearOnboardingDraft(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingDraft: Prisma.DbNull },
    });
    return {
      message: 'Xóa nháp Onboarding thành công',
    };
  }
}
