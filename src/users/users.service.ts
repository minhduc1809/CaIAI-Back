import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCalculatorService } from './health-calculator.service';
import { AdaptiveExpenditureService } from './adaptive-expenditure.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
        equipmentAccess: true,
        injuries: true,
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
    const heightCm = dto.heightCm !== undefined ? dto.heightCm : currentUser.heightCm;
    const weightKg = dto.weightKg !== undefined ? dto.weightKg : currentUser.weightKg;
    const targetWeightKg = dto.targetWeightKg !== undefined ? dto.targetWeightKg : currentUser.targetWeightKg;
    const weightRateKgPerWeek = dto.weightRateKgPerWeek !== undefined ? dto.weightRateKgPerWeek : currentUser.weightRateKgPerWeek;
    const bodyFatPercent = dto.bodyFatPercent !== undefined ? dto.bodyFatPercent : currentUser.bodyFatPercent;
    const dateOfBirth = dto.dateOfBirth !== undefined ? (dto.dateOfBirth ? new Date(dto.dateOfBirth) : null) : currentUser.dateOfBirth;
    const gender = dto.gender !== undefined ? dto.gender : currentUser.gender;
    const activityLevel = dto.activityLevel !== undefined ? dto.activityLevel : currentUser.activityLevel;
    const goal = dto.goal !== undefined ? dto.goal : currentUser.goal;
    const macroStyle = dto.macroStyle !== undefined ? dto.macroStyle : currentUser.macroStyle;

    // 3a. Tính TDEE công thức tĩnh trước (baseline & sanity bound cho Adaptive Engine)
    const staticCalculations = this.healthCalculator.calculateAllMetrics({
      heightCm,
      weightKg,
      targetWeightKg,
      weightRateKgPerWeek,
      bodyFatPercent,
      dateOfBirth,
      gender,
      activityLevel,
      goal,
      macroStyle,
    });

    // 3b. Adaptive Expenditure Engine — hồi quy dữ liệu cân nặng + calo đã log thực tế
    const expenditureResult = await this.adaptiveExpenditure.recalculate(
      userId,
      staticCalculations.tdee,
      currentUser.adaptiveExpenditure,
    );

    // 3c. Tính lại Target Calories/Macro dựa trên Expenditure thích ứng (nếu có) thay vì TDEE tĩnh
    const calculations = this.healthCalculator.calculateAllMetrics({
      heightCm,
      weightKg,
      targetWeightKg,
      weightRateKgPerWeek,
      bodyFatPercent,
      dateOfBirth,
      gender,
      activityLevel,
      goal,
      macroStyle,
      expenditureOverride: expenditureResult.method === 'ADAPTIVE' ? expenditureResult.estimatedExpenditure : null,
    });

    // 4. Cập nhật vào Database
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name !== undefined ? dto.name : currentUser.name,
        avatar: dto.avatar !== undefined ? dto.avatar : currentUser.avatar,
        gender,
        dateOfBirth,
        heightCm,
        weightKg,
        targetWeightKg,
        weightRateKgPerWeek,
        bodyFatPercent,
        activityLevel,
        goal,
        macroStyle: calculations.macroStyle,
        timezone: dto.timezone !== undefined ? dto.timezone : currentUser.timezone,
        sleepHours: dto.sleepHours !== undefined ? dto.sleepHours : currentUser.sleepHours,
        stressLevel: dto.stressLevel !== undefined ? dto.stressLevel : currentUser.stressLevel,
        takesSupplements: dto.takesSupplements !== undefined ? dto.takesSupplements : currentUser.takesSupplements,
        dietType: dto.dietType !== undefined ? dto.dietType : currentUser.dietType,
        mealsPerDay: dto.mealsPerDay !== undefined ? dto.mealsPerDay : currentUser.mealsPerDay,
        cookTimeMinutes: dto.cookTimeMinutes !== undefined ? dto.cookTimeMinutes : currentUser.cookTimeMinutes,
        foodBudgetLevel: dto.foodBudgetLevel !== undefined ? dto.foodBudgetLevel : currentUser.foodBudgetLevel,
        trainingExperience: dto.trainingExperience !== undefined ? dto.trainingExperience : currentUser.trainingExperience,
        trainingGoal: dto.trainingGoal !== undefined ? dto.trainingGoal : currentUser.trainingGoal,
        sessionsPerWeek: dto.sessionsPerWeek !== undefined ? dto.sessionsPerWeek : currentUser.sessionsPerWeek,
        equipmentAccess: dto.equipmentAccess !== undefined ? dto.equipmentAccess : currentUser.equipmentAccess,
        injuries: dto.injuries !== undefined ? dto.injuries : currentUser.injuries,
        injuriesOtherNote: dto.injuriesOtherNote !== undefined ? dto.injuriesOtherNote : currentUser.injuriesOtherNote,
        oneRepMaxSquatKg: dto.oneRepMaxSquatKg !== undefined ? dto.oneRepMaxSquatKg : currentUser.oneRepMaxSquatKg,
        oneRepMaxBenchKg: dto.oneRepMaxBenchKg !== undefined ? dto.oneRepMaxBenchKg : currentUser.oneRepMaxBenchKg,
        oneRepMaxDeadliftKg: dto.oneRepMaxDeadliftKg !== undefined ? dto.oneRepMaxDeadliftKg : currentUser.oneRepMaxDeadliftKg,
        programType: dto.programType !== undefined ? dto.programType : currentUser.programType,
        proteinPreference: dto.proteinPreference !== undefined ? dto.proteinPreference : currentUser.proteinPreference,
        isIntermittentFasting: dto.isIntermittentFasting !== undefined ? dto.isIntermittentFasting : currentUser.isIntermittentFasting,
        ifWindowStart: dto.ifWindowStart !== undefined ? dto.ifWindowStart : currentUser.ifWindowStart,
        ifWindowEnd: dto.ifWindowEnd !== undefined ? dto.ifWindowEnd : currentUser.ifWindowEnd,
        // Các chỉ số tính toán
        bmi: calculations.bmi,
        bmr: calculations.bmr,
        tdee: calculations.tdee,
        targetCalories: calculations.targetCalories,
        targetProtein: calculations.targetProtein,
        targetCarb: calculations.targetCarb,
        targetFat: calculations.targetFat,
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
        equipmentAccess: true,
        injuries: true,
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
      },
    };
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
      user.adaptiveExpenditure,
    );

    return {
      message: 'Lấy trạng thái Expenditure thành công',
      data: expenditureResult,
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

  private generateQuickHealthAdvice(goal: string | null, bmi: number | null): string {
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
}
