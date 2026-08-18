import { Injectable } from '@nestjs/common';
import { Gender, GoalType, ActivityLevel } from '@prisma/client';

export interface HealthMetricsInput {
  heightCm?: number | null;
  weightKg?: number | null;
  dateOfBirth?: Date | string | null;
  gender?: Gender | null;
  activityLevel?: ActivityLevel | null;
  goal?: GoalType | null;
}

export interface HealthCalculationsResult {
  bmi: number | null;
  bmiClassification: string | null;
  bmr: number | null;
  tdee: number | null;
  targetCalories: number | null;
  targetProtein: number | null; // gram
  targetCarb: number | null;    // gram
  targetFat: number | null;     // gram
}

@Injectable()
export class HealthCalculatorService {
  /**
   * Tính toán toàn bộ chỉ số BMI, BMR, TDEE, Calo mục tiêu và Macros
   */
  calculateAllMetrics(input: HealthMetricsInput): HealthCalculationsResult {
    const { heightCm, weightKg, dateOfBirth, gender, activityLevel, goal } = input;

    // 1. Tính BMI
    const bmi = this.calculateBMI(heightCm, weightKg);
    const bmiClassification = this.classifyBMI(bmi);

    // 2. Tính tuổi
    const age = this.calculateAge(dateOfBirth);

    // 3. Tính BMR
    const bmr = this.calculateBMR(heightCm, weightKg, age, gender);

    // 4. Tính TDEE
    const tdee = this.calculateTDEE(bmr, activityLevel);

    // 5. Tính Calo mục tiêu (Target Calories)
    const targetCalories = this.calculateTargetCalories(tdee, goal);

    // 6. Phân bổ Macros (Protein, Carb, Fat)
    const macros = this.calculateMacros(targetCalories, weightKg, goal);

    return {
      bmi,
      bmiClassification,
      bmr,
      tdee,
      targetCalories,
      targetProtein: macros.protein,
      targetCarb: macros.carb,
      targetFat: macros.fat,
    };
  }

  /**
   * BMI = Cân nặng (kg) / (Chiều cao (m))^2
   */
  private calculateBMI(heightCm?: number | null, weightKg?: number | null): number | null {
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
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age > 0 ? age : null;
  }

  /**
   * Công thức Mifflin-St Jeor chuẩn quốc tế:
   * - Nam: 10 * weight(kg) + 6.25 * height(cm) - 5 * age + 5
   * - Nữ:  10 * weight(kg) + 6.25 * height(cm) - 5 * age - 161
   */
  private calculateBMR(
    heightCm?: number | null,
    weightKg?: number | null,
    age?: number | null,
    gender?: Gender | null,
  ): number | null {
    if (!heightCm || !weightKg || !age || !gender) return null;

    const baseBMR = 10 * weightKg + 6.25 * heightCm - 5 * age;
    let bmr = gender === Gender.MALE ? baseBMR + 5 : baseBMR - 161;

    return Math.round(bmr);
  }

  /**
   * TDEE = BMR * Hệ số vận động (Physical Activity Level)
   */
  private calculateTDEE(bmr: number | null, activityLevel?: ActivityLevel | null): number | null {
    if (!bmr) return null;

    let multiplier = 1.2; // Mặc định SEDENTARY

    switch (activityLevel) {
      case ActivityLevel.SEDENTARY:
        multiplier = 1.2; // Ít vận động, ngồi văn phòng
        break;
      case ActivityLevel.LIGHTLY_ACTIVE:
        multiplier = 1.375; // Vận động nhẹ 1-3 ngày/tuần
        break;
      case ActivityLevel.MODERATELY_ACTIVE:
        multiplier = 1.55; // Vận động vừa 3-5 ngày/tuần
        break;
      case ActivityLevel.VERY_ACTIVE:
        multiplier = 1.725; // Vận động nhiều 6-7 ngày/tuần
        break;
      case ActivityLevel.EXTRA_ACTIVE:
        multiplier = 1.9; // Cường độ rất cao / VĐV
        break;
      default:
        multiplier = 1.2;
    }

    return Math.round(bmr * multiplier);
  }

  /**
   * Tính Calo mục tiêu:
   * - Giảm cân: Calorie Deficit (-500 kcal an toàn, giảm ~0.5kg/tuần)
   * - Giữ cân: TDEE
   * - Tăng cân: Calorie Surplus (+400 kcal)
   */
  private calculateTargetCalories(tdee: number | null, goal?: GoalType | null): number | null {
    if (!tdee) return null;

    let target = tdee;
    if (goal === GoalType.LOSE_WEIGHT) {
      target = Math.max(tdee - 500, 1200); // Không để tụt dưới 1200 kcal
    } else if (goal === GoalType.GAIN_WEIGHT) {
      target = tdee + 400;
    }

    return Math.round(target);
  }

  /**
   * Phân bổ Tỷ lệ Macro chuẩn khoa học:
   * - Giảm cân: 35% Protein, 40% Carb, 25% Fat
   * - Giữ cân: 30% Protein, 45% Carb, 25% Fat
   * - Tăng cân: 25% Protein, 55% Carb, 20% Fat
   * (1g Protein = 4 kcal, 1g Carb = 4 kcal, 1g Fat = 9 kcal)
   */
  private calculateMacros(targetCalories: number | null, weightKg?: number | null, goal?: GoalType | null) {
    if (!targetCalories) {
      return { protein: null, carb: null, fat: null };
    }

    let proteinRatio = 0.3;
    let carbRatio = 0.45;
    let fatRatio = 0.25;

    if (goal === GoalType.LOSE_WEIGHT) {
      proteinRatio = 0.35;
      carbRatio = 0.4;
      fatRatio = 0.25;
    } else if (goal === GoalType.GAIN_WEIGHT) {
      proteinRatio = 0.25;
      carbRatio = 0.55;
      fatRatio = 0.2;
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
