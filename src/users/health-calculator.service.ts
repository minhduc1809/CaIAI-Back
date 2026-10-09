import { Injectable } from '@nestjs/common';
import {
  Gender,
  GoalType,
  ActivityLevel,
  MacroStyle,
  SessionsPerWeek,
  TargetLimit,
  PregnancyStatus,
  ProteinPreference,
} from '@prisma/client';

/**
 * Giới hạn an toàn của mục tiêu calo (BR-03.3 đến BR-03.7).
 */
export const NUTRITION_LIMITS = {
  calorieFloorFemale: 1200,
  calorieFloorMale: 1500,
  /** Thâm hụt tối đa so với mức năng lượng nền E (%). */
  maxDeficitPctOfE: 25,
  /** Thặng dư tối đa so với mức năng lượng nền E (%). */
  maxSurplusPctOfE: 15,
  /** Năng lượng bổ sung cho thai kỳ (kcal/ngày, BR-02.2). */
  pregnancyEnergyAddKcal: 300,
  /** Năng lượng bổ sung cho con bú (kcal/ngày, BR-02.2). */
  lactationEnergyAddKcal: 500,
  /** Sàn chất béo tối thiểu g/kg cân nặng (BR-03.5: ưu tiên an toàn nội tiết tố). */
  minFatGramPerKg: 0.7,
  /** Tỷ lệ calo tối thiểu từ chất béo (%). */
  minFatPctOfCalories: 20,
  /** Sàn chất béo tuyệt đối cho nữ (g). */
  minFatAbsoluteFemale: 40,
  /** Sàn chất béo tuyệt đối cho nam (g). */
  minFatAbsoluteMale: 45,
} as const;

export interface HealthMetricsInput {
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  weightRateKgPerWeek?: number | null;
  weightRatePercent?: number | null;
  bodyFatPercent?: number | null;
  dateOfBirth?: Date | string | null;
  gender?: Gender | null;
  pregnancyStatus?: PregnancyStatus | null;
  activityLevel?: ActivityLevel | null;
  goal?: GoalType | null;
  macroStyle?: MacroStyle | null;
  proteinPreference?: ProteinPreference | null;
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
  /** Quy tắc an toàn đã giới hạn mục tiêu (null = không bị giới hạn). */
  targetLimitedBy: TargetLimit | null;
  targetProtein: number | null; // gram
  targetCarb: number | null; // gram
  targetFat: number | null; // gram
  macroStyle: MacroStyle;
}

/**
 * Suy nhóm hệ số vận động từ số buổi tập mỗi tuần (BR-03.2): 0 → ít vận động (1.2), 1–2 → nhẹ (1.375),
 * 3–4 → vừa (1.55), 5–6 → nhiều (1.725), 7 → rất nhiều (1.9). Đây là nguồn duy nhất của phép suy luận này.
 */
export function activityLevelFromTrainingDays(days: number): ActivityLevel {
  if (days <= 0) return ActivityLevel.SEDENTARY;
  if (days <= 2) return ActivityLevel.LIGHTLY_ACTIVE;
  if (days <= 4) return ActivityLevel.MODERATELY_ACTIVE;
  if (days <= 6) return ActivityLevel.VERY_ACTIVE;
  return ActivityLevel.EXTRA_ACTIVE;
}

/** Nhóm SessionsPerWeek tương ứng (giữ cho tương thích); 0 buổi không có nhóm nên trả null. */
export function sessionsBucketFromTrainingDays(
  days: number,
): SessionsPerWeek | null {
  if (days <= 0) return null;
  if (days <= 2) return SessionsPerWeek.ONE_TO_TWO;
  if (days <= 4) return SessionsPerWeek.THREE_TO_FOUR;
  if (days <= 6) return SessionsPerWeek.FIVE_TO_SIX;
  return SessionsPerWeek.SEVEN;
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

    const effectiveRate =
      weightRateKgPerWeek !== undefined && weightRateKgPerWeek !== null
        ? weightRateKgPerWeek
        : input.weightRatePercent && weightKg
          ? (input.weightRatePercent * weightKg) / 100
          : null;

    // 5. Tính Calo mục tiêu — ưu tiên Adaptive Expenditure (nếu đã hội tụ/đang cập nhật) thay vì TDEE công thức tĩnh
    const expenditureForTarget = expenditureOverride ?? tdee;
    const { calories: targetCalories, limitedBy: targetLimitedBy } =
      this.calculateTargetFromEnergy(
        expenditureForTarget,
        goal,
        effectiveRate,
        {
          gender,
          bmr: bmrResult.bmr,
          pregnancyStatus: input.pregnancyStatus,
        },
      );

    // 6. Phân bổ Macros theo trường phái dinh dưỡng đã chọn (MacroStyle, BR-03.4 & BR-03.5)
    const resolvedMacroStyle = macroStyle || MacroStyle.BALANCED;
    const macros = this.calculateMacros(targetCalories, resolvedMacroStyle, {
      weightKg,
      heightCm,
      gender,
      goal,
      proteinPreference: input.proteinPreference,
      bodyFatPercent,
    });

    return {
      bmi,
      bmiClassification,
      bmr: bmrResult.bmr,
      bmrFormula: bmrResult.formula,
      tdee,
      targetCalories,
      targetLimitedBy,
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

  /** Sàn calo theo giới (BR-03.3); giới tính không xác định thì dùng mức cao hơn cho an toàn. */
  private calorieFloorFor(gender?: Gender | null): number {
    return gender === Gender.FEMALE
      ? NUTRITION_LIMITS.calorieFloorFemale
      : NUTRITION_LIMITS.calorieFloorMale;
  }

  /**
   * Tính Calo mục tiêu từ mức năng lượng nền E (Expenditure thích ứng hoặc TDEE tĩnh) và tốc độ
   * thay đổi cân nặng (kg/tuần), áp các giới hạn an toàn của BR-03.3:
   * - Chênh lệch/ngày D = tốc độ × 7700 / 7.
   * - Giảm cân: E − D, nhưng D không vượt 25% E và kết quả không thấp hơn max(sàn theo giới, BMR).
   * - Tăng cân: E + D, nhưng D không vượt 15% E.
   * - Duy trì: bằng E.
   * Trả kèm quy tắc đã giới hạn (targetLimitedBy) để app giải thích cho người dùng.
   */
  calculateTargetFromEnergy(
    energy: number | null,
    goal?: GoalType | null,
    weightRateKgPerWeek?: number | null,
    opts?: {
      gender?: Gender | null;
      bmr?: number | null;
      pregnancyStatus?: PregnancyStatus | null;
    },
  ): { calories: number | null; limitedBy: TargetLimit | null } {
    if (!energy) return { calories: null, limitedBy: null };

    // Điều chỉnh năng lượng thai kỳ / cho con bú (BR-02.2)
    let adjustedEnergy = energy;
    if (opts?.gender === Gender.FEMALE) {
      if (opts?.pregnancyStatus === PregnancyStatus.PREGNANT) {
        adjustedEnergy += NUTRITION_LIMITS.pregnancyEnergyAddKcal;
      } else if (opts?.pregnancyStatus === PregnancyStatus.LACTATING) {
        adjustedEnergy += NUTRITION_LIMITS.lactationEnergyAddKcal;
      }
    }

    // Phụ nữ mang thai hoặc cho con bú: cấm thâm hụt calo, duy trì hoặc tăng nhẹ
    const effectiveGoal =
      opts?.gender === Gender.FEMALE &&
      (opts?.pregnancyStatus === PregnancyStatus.PREGNANT ||
        opts?.pregnancyStatus === PregnancyStatus.LACTATING) &&
      goal === GoalType.LOSE_WEIGHT
        ? GoalType.MAINTAIN
        : goal;

    const rate =
      weightRateKgPerWeek && weightRateKgPerWeek > 0
        ? weightRateKgPerWeek
        : 0.5;
    let delta = (rate * 7700) / 7;
    let limitedBy: TargetLimit | null = null;
    let target = adjustedEnergy;

    if (effectiveGoal === GoalType.LOSE_WEIGHT) {
      const maxDeficit =
        (adjustedEnergy * NUTRITION_LIMITS.maxDeficitPctOfE) / 100;
      if (delta > maxDeficit) {
        delta = maxDeficit;
        limitedBy = TargetLimit.DEFICIT_CAP;
      }
      target = adjustedEnergy - delta;

      const floor = Math.max(
        this.calorieFloorFor(opts?.gender),
        opts?.bmr ?? 0,
      );
      if (target < floor) {
        // Sàn không bao giờ đẩy mục tiêu giảm cân lên cao hơn mức nền
        target = Math.min(floor, adjustedEnergy);
        limitedBy = TargetLimit.FLOOR;
      }
    } else if (effectiveGoal === GoalType.GAIN_WEIGHT) {
      const maxSurplus =
        (adjustedEnergy * NUTRITION_LIMITS.maxSurplusPctOfE) / 100;
      if (delta > maxSurplus) {
        delta = maxSurplus;
        limitedBy = TargetLimit.SURPLUS_CAP;
      }
      target = adjustedEnergy + delta;
    }

    return { calories: Math.round(target), limitedBy };
  }

  /**
   * Phân bổ tỷ lệ Macro (BR-03.3 đến BR-03.7):
   * 1. Đạm theo g/kg (BR-03.4):
   *    - LOSE_WEIGHT (bảo toàn khối cơ): 2.0 g/kg (LOW=1.6, MID=2.0, HIGH=2.2, VERY_HIGH=2.4)
   *    - MAINTAIN: 1.8 g/kg (LOW=1.4, MID=1.8, HIGH=2.0, VERY_HIGH=2.2)
   *    - GAIN_WEIGHT: 1.8 - 2.0 g/kg
   *    - Béo phì (BMI >= 30 hoặc mỡ cao): tính theo Lean Body Mass (LBM) để chống đạm vượt trần.
   * 2. Béo tối thiểu (Fat Floor - BR-03.5):
   *    - Sàn an toàn: tối thiểu 0.7 g/kg cân nặng, tối thiểu 20% tổng calo, và tối thiểu sàn tuyệt đối (nữ 40g, nam 45g).
   * 3. Carb nhận phần calo còn lại: Carb = (TargetCalories - Protein * 4 - Fat * 9) / 4.
   * 4. Cân bằng sai số làm tròn để tổng calo từ P, C, F khớp TargetCalories (BR-03.7).
   */
  calculateMacros(
    targetCalories: number | null,
    style: MacroStyle,
    opts?: {
      weightKg?: number | null;
      heightCm?: number | null;
      gender?: Gender | null;
      goal?: GoalType | null;
      proteinPreference?: ProteinPreference | null;
      bodyFatPercent?: number | null;
    },
  ) {
    if (!targetCalories) {
      return { protein: null, carb: null, fat: null };
    }

    const weightKg = opts?.weightKg;
    let proteinGram: number;

    if (weightKg && weightKg > 0) {
      const pref = opts?.proteinPreference || ProteinPreference.MID;
      const isLose = opts?.goal === GoalType.LOSE_WEIGHT;
      const isGain = opts?.goal === GoalType.GAIN_WEIGHT;

      // Hệ số g/kg cơ bản theo mục tiêu và proteinPreference (C1 / BR-03.4)
      // LOSE: 2.0, MAINTAIN: 1.6, GAIN: 1.8
      let baseFactor = 1.6;
      if (isLose) baseFactor = 2.0;
      else if (isGain) baseFactor = 1.8;
      else baseFactor = 1.6;

      let prefStep = 0;
      if (pref === ProteinPreference.LOW) prefStep = -0.2;
      else if (pref === ProteinPreference.HIGH) prefStep = 0.2;
      else if (pref === ProteinPreference.VERY_HIGH) prefStep = 0.4;

      const factor = baseFactor + prefStep;

      // Cân nặng dùng để tính đạm (C1):
      // - Có % mỡ (3–60%): LBM / 0.85 (LBM = cân × (1 − %mỡ))
      // - BMI ≥ 30 và không có % mỡ: cân nặng ứng với BMI 25 (tránh thổi phồng đạm cho người béo phì)
      // - Còn lại: cân nặng hiện tại
      let weightForProtein = weightKg;
      if (
        opts?.bodyFatPercent &&
        opts.bodyFatPercent >= 3 &&
        opts.bodyFatPercent <= 60
      ) {
        const lbm = weightKg * (1 - opts.bodyFatPercent / 100);
        weightForProtein = lbm / 0.85;
      } else if (opts?.heightCm && opts.heightCm > 0) {
        const heightM = opts.heightCm / 100;
        const currentBmi = weightKg / (heightM * heightM);
        if (currentBmi >= 30) {
          weightForProtein = 25 * (heightM * heightM);
        }
      }

      proteinGram = Math.round(weightForProtein * factor);

      // Ràng buộc trần: đạm ≤ 35% tổng calo (C1 / macro.proteinMaxPctKcal)
      const maxProteinGram = Math.round((targetCalories * 0.35) / 4);
      proteinGram = Math.min(proteinGram, maxProteinGram);
    } else {
      // Fallback khi chưa có cân nặng: 30% calo
      proteinGram = Math.round((targetCalories * 0.3) / 4);
    }

    const proteinCals = proteinGram * 4;

    // 2. Tính sàn chất béo tối thiểu (Fat Floor - BR-03.5)
    const refWeight = weightKg && weightKg > 0 ? weightKg : 60;
    const isFemale = opts?.gender === Gender.FEMALE;
    const absoluteMinFat = isFemale
      ? NUTRITION_LIMITS.minFatAbsoluteFemale
      : NUTRITION_LIMITS.minFatAbsoluteMale;
    const fatFloor = Math.max(
      Math.round(refWeight * NUTRITION_LIMITS.minFatGramPerKg),
      Math.round(
        (targetCalories * (NUTRITION_LIMITS.minFatPctOfCalories / 100)) / 9,
      ),
      absoluteMinFat,
    );

    let targetFatRatio = 0.28;
    switch (style) {
      case MacroStyle.HIGH_CARB_LOW_FAT:
        targetFatRatio = 0.2;
        break;
      case MacroStyle.LOW_CARB_HIGH_FAT:
        targetFatRatio = 0.42;
        break;
      case MacroStyle.KETO:
        targetFatRatio = 0.7;
        break;
      case MacroStyle.BALANCED:
      default:
        targetFatRatio = 0.28;
    }

    let fatGram = Math.round((targetCalories * targetFatRatio) / 9);
    // Áp dụng sàn chất béo tối thiểu (ưu tiên an toàn nội tiết tố)
    fatGram = Math.max(fatGram, fatFloor);

    // Đảm bảo Fat không chiếm vượt quá calo sau khi đã trừ đạm
    const minCarbCalories = style === MacroStyle.KETO ? 80 : 120; // 20g carb cho keto, 30g carb tối thiểu thông thường
    const maxFatGram = Math.max(
      fatFloor,
      Math.round((targetCalories - proteinCals - minCarbCalories) / 9),
    );
    fatGram = Math.min(fatGram, maxFatGram);
    const fatCals = fatGram * 9;

    // 3. Carb nhận phần calo còn lại
    const remainingCals = Math.max(0, targetCalories - proteinCals - fatCals);
    let carbGram = Math.round(remainingCals / 4);

    // KETO: giới hạn carb <= 35g, calo dư chuyển sang béo
    if (style === MacroStyle.KETO && carbGram > 35) {
      const excessCarb = carbGram - 30;
      carbGram = 30;
      fatGram += Math.round((excessCarb * 4) / 9);
    }

    // 4. Cân bằng sai số làm tròn (BR-03.7)
    let currentTotal = proteinGram * 4 + carbGram * 4 + fatGram * 9;
    let diff = targetCalories - currentTotal;

    if (style !== MacroStyle.KETO) {
      const carbAdjust = Math.round(diff / 4);
      carbGram += carbAdjust;
    } else {
      const fatAdjust = Math.round(diff / 9);
      fatGram += fatAdjust;
      currentTotal = proteinGram * 4 + carbGram * 4 + fatGram * 9;
      diff = targetCalories - currentTotal;
      if (Math.abs(diff) > 3) {
        carbGram += Math.round(diff / 4);
      }
    }

    return {
      protein: Math.max(0, proteinGram),
      carb: Math.max(0, carbGram),
      fat: Math.max(0, fatGram),
    };
  }
}
