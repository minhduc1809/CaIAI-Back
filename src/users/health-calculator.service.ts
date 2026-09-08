import { Injectable } from '@nestjs/common';
import { Gender, GoalType, ActivityLevel, MacroStyle } from '@prisma/client';

export interface HealthMetricsInput {
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  weightRateKgPerWeek?: number | null;
  bodyFatPercent?: number | null;
  dateOfBirth?: Date | string | null;
  gender?: Gender | null;
  activityLevel?: ActivityLevel | null;
  goal?: GoalType | null;
  macroStyle?: MacroStyle | null;
  /** Ước tính Expenditure thích ứng (Adaptive Expenditure Engine) — khi có, dùng thay TDEE công thức tĩnh để tính Target Calories. */
  expenditureOverride?: number | null;
}

export interface HealthCalculationsResult {
  bmi: number | null;
  bmiClassification: string | null;
  bmr: number | null;
  bmrFormula: string;
  tdee: number | null;
  targetCalories: number | null;
  targetProtein: number | null; // gram
  targetCarb: number | null; // gram
  targetFat: number | null; // gram
  macroStyle: MacroStyle;
}

@Injectable()
export class HealthCalculatorService {
  /**
   * Tính toán toàn bộ chỉ số BMI, BMR, TDEE, Calo mục tiêu và Macros theo chuẩn BRD
   */
  calculateAllMetrics(input: HealthMetricsInput): HealthCalculationsResult {
    const {
      heightCm,
      weightKg,
      bodyFatPercent,
      dateOfBirth,
      gender,
      activityLevel,
      goal,
      weightRateKgPerWeek,
      macroStyle = MacroStyle.BALANCED,
      expenditureOverride,
    } = input;

    // 1. Tính BMI
    const bmi = this.calculateBMI(heightCm, weightKg);
    const bmiClassification = this.classifyBMI(bmi);

    // 2. Tính tuổi
    const age = this.calculateAge(dateOfBirth);

    // 3. Tính BMR (Katch-McArdle nếu có % mỡ, hoặc Mifflin-St Jeor)
    const bmrResult = this.calculateBMR(
      heightCm,
      weightKg,
      age,
      gender,
      bodyFatPercent,
    );

    // 4. Tính TDEE
    const tdee = this.calculateTDEE(bmrResult.bmr, activityLevel);

    // 5. Tính Calo mục tiêu — ưu tiên Adaptive Expenditure (nếu đã hội tụ/đang cập nhật) thay vì TDEE công thức tĩnh
    const expenditureForTarget = expenditureOverride ?? tdee;
    const targetCalories = this.calculateTargetCalories(
      expenditureForTarget,
      goal,
      weightRateKgPerWeek,
    );

    // 6. Phân bổ Macros theo trường phái dinh dưỡng đã chọn (MacroStyle)
    const resolvedMacroStyle = macroStyle || MacroStyle.BALANCED;
    const macros = this.calculateMacros(targetCalories, resolvedMacroStyle);

    return {
      bmi,
      bmiClassification,
      bmr: bmrResult.bmr,
      bmrFormula: bmrResult.formula,
      tdee,
      targetCalories,
      targetProtein: macros.protein,
      targetCarb: macros.carb,
      targetFat: macros.fat,
      macroStyle: resolvedMacroStyle,
    };
  }

  /**
   * BMI = Cân nặng (kg) / (Chiều cao (m))^2
   */
  private calculateBMI(
    heightCm?: number | null,
    weightKg?: number | null,
  ): number | null {
    if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    return Math.round(bmi * 10) / 10;
  }

  /**
   * Xếp loại thể trạng theo tiêu chuẩn WHO dành cho người châu Á (IDI & WPRO)
   */
  private classifyBMI(bmi: number | null): string | null {
    if (!bmi) return null;
    if (bmi < 18.5) return 'Gầy (Underweight) - Cần tăng cân lành mạnh';
    if (bmi < 23) return 'Bình thường (Normal) - Thể trạng lý tưởng';
    if (bmi < 25) return 'Tiền béo phì / Thừa cân (Overweight)';
    if (bmi < 30) return 'Béo phì độ I (Obesity Class I)';
    return 'Béo phì độ II (Obesity Class II)';
  }

  /**
   * Tính tuổi dựa trên ngày sinh
   */
  private calculateAge(dateOfBirth?: Date | string | null): number | null {
    if (!dateOfBirth) return null;
    const birth = new Date(dateOfBirth);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }
    return age > 0 ? age : null;
  }

  /**
   * Tính BMR:
   * - Nếu có bodyFatPercent: Công thức Katch-McArdle (LBM = weight * (1 - bf/100), BMR = 370 + 21.6 * LBM)
   * - Ngược lại: Công thức Mifflin-St Jeor
   */
  private calculateBMR(
    heightCm?: number | null,
    weightKg?: number | null,
    age?: number | null,
    gender?: Gender | null,
    bodyFatPercent?: number | null,
  ): { bmr: number | null; formula: string } {
    if (!weightKg || weightKg <= 0) return { bmr: null, formula: 'None' };

    // Ưu tiên Katch-McArdle nếu có % mỡ cơ thể
    if (bodyFatPercent && bodyFatPercent > 3 && bodyFatPercent < 60) {
      const lbm = weightKg * (1 - bodyFatPercent / 100);
      const bmr = 370 + 21.6 * lbm;
      return {
        bmr: Math.round(bmr),
        formula: 'Katch-McArdle (Dựa trên Lean Body Mass)',
      };
    }

    if (!heightCm || !age || !gender) return { bmr: null, formula: 'None' };

    const baseBMR = 10 * weightKg + 6.25 * heightCm - 5 * age;
    const bmr = gender === Gender.MALE ? baseBMR + 5 : baseBMR - 161;

    return { bmr: Math.round(bmr), formula: 'Mifflin-St Jeor' };
  }

  /**
   * TDEE = BMR * Hệ số vận động (Physical Activity Level)
   */
  private calculateTDEE(
    bmr: number | null,
    activityLevel?: ActivityLevel | null,
  ): number | null {
    if (!bmr) return null;

    let multiplier = 1.2;

    switch (activityLevel) {
      case ActivityLevel.SEDENTARY:
        multiplier = 1.2;
        break;
      case ActivityLevel.LIGHTLY_ACTIVE:
        multiplier = 1.375;
        break;
      case ActivityLevel.MODERATELY_ACTIVE:
        multiplier = 1.55;
        break;
      case ActivityLevel.VERY_ACTIVE:
        multiplier = 1.725;
        break;
      case ActivityLevel.EXTRA_ACTIVE:
        multiplier = 1.9;
        break;
      default:
        multiplier = 1.2;
    }

    return Math.round(bmr * multiplier);
  }

  /**
   * Tính Calo mục tiêu dựa trên Tốc độ thay đổi cân nặng (kg/tuần):
   * 1 kg mỡ = ~7700 kcal.
   * Thâm hụt hoặc thặng dư calo/ngày = (weightRateKgPerWeek * 7700) / 7.
   */
  private calculateTargetCalories(
    tdee: number | null,
    goal?: GoalType | null,
    weightRateKgPerWeek?: number | null,
  ): number | null {
    if (!tdee) return null;

    const rate =
      weightRateKgPerWeek && weightRateKgPerWeek > 0
        ? weightRateKgPerWeek
        : 0.5;
    const deltaPerDay = Math.round((rate * 7700) / 7);

    let target = tdee;
    if (goal === GoalType.LOSE_WEIGHT) {
      target = Math.max(tdee - deltaPerDay, 1200); // Ngưỡng an toàn tối thiểu 1200 kcal
    } else if (goal === GoalType.GAIN_WEIGHT) {
      target = tdee + deltaPerDay;
    }

    return Math.round(target);
  }

  /**
   * Phân bổ tỷ lệ Macro theo từng trường phái dinh dưỡng:
   * - BALANCED: 30% Protein, 40% Carb, 30% Fat
   * - HIGH_CARB_LOW_FAT: 30% Protein, 55% Carb, 15% Fat (VĐV / chạy bền)
   * - LOW_CARB_HIGH_FAT: 35% Protein, 20% Carb, 45% Fat
   * - KETO: 25% Protein, 5% Carb, 70% Fat
   */
  private calculateMacros(targetCalories: number | null, style: MacroStyle) {
    if (!targetCalories) {
      return { protein: null, carb: null, fat: null };
    }

    let proteinRatio = 0.3;
    let carbRatio = 0.4;
    let fatRatio = 0.3;

    switch (style) {
      case MacroStyle.HIGH_CARB_LOW_FAT:
        proteinRatio = 0.3;
        carbRatio = 0.55;
        fatRatio = 0.15;
        break;
      case MacroStyle.LOW_CARB_HIGH_FAT:
        proteinRatio = 0.35;
        carbRatio = 0.2;
        fatRatio = 0.45;
        break;
      case MacroStyle.KETO:
        proteinRatio = 0.25;
        carbRatio = 0.05;
        fatRatio = 0.7;
        break;
      case MacroStyle.BALANCED:
      default:
        proteinRatio = 0.3;
        carbRatio = 0.4;
        fatRatio = 0.3;
    }

    const proteinGram = Math.round((targetCalories * proteinRatio) / 4);
    const carbGram = Math.round((targetCalories * carbRatio) / 4);
    const fatGram = Math.round((targetCalories * fatRatio) / 9);

    return {
      protein: proteinGram,
      carb: carbGram,
      fat: fatGram,
    };
  }
}
