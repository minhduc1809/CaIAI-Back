import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptiveExpenditureService } from '../users/adaptive-expenditure.service';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { CheckInStatus, CheckInAdjustmentReason, MacroStyle, ProgramType, GoalType } from '@prisma/client';
import { RespondCheckinDto } from './dto/respond-checkin.dto';
import { CreateCheckinDto } from './dto/create-checkin.dto';

/** Guardrail smoothing ±10%/tuần (C018) */
const SMOOTHING_LIMIT_RATIO = 0.1;
const KCAL_PER_KG = 7700;

@Injectable()
export class CheckinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenditureService: AdaptiveExpenditureService,
    private readonly healthCalc: HealthCalculatorService,
    private readonly weightLogsService: WeightLogsService,
  ) {}

  /**
   * Tạo/cập nhật check-in cho tuần hiện tại.
   * Chỉ áp dụng với programType = COACHED | COLLABORATIVE.
   * Nếu đã tồn tại check-in PENDING/DISMISSED trong tuần này → cập nhật lại dữ liệu.
   */
  async generateCheckin(userId: string, dto: CreateCheckinDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    if (user.programType === ProgramType.MANUAL) {
      throw new BadRequestException('Tính năng Check-in không áp dụng cho chế độ Manual');
    }

    // Xác định khoảng tuần hiện tại (Thứ 2 → Chủ Nhật theo múi giờ Việt Nam)
    const { weekStartDate, weekEndDate, weekNumber } = this.getCurrentWeekRange();

    // Lấy thống kê tuần qua (7 ngày kể từ weekStartDate)
    const since = weekStartDate;
    const until = new Date(); // đến hiện tại

    const meals = await this.prisma.meal.findMany({
      where: { userId, date: { gte: since, lte: until } },
      select: { date: true, totalCalories: true, totalProtein: true, totalCarb: true, totalFat: true },
    });

    const caloriesByDay = new Map<string, number>();
    const proteinByDay = new Map<string, number>();
    const carbByDay = new Map<string, number>();
    const fatByDay = new Map<string, number>();
    for (const meal of meals) {
      const key = meal.date.toISOString().split('T')[0];
      caloriesByDay.set(key, (caloriesByDay.get(key) ?? 0) + meal.totalCalories);
      proteinByDay.set(key, (proteinByDay.get(key) ?? 0) + meal.totalProtein);
      carbByDay.set(key, (carbByDay.get(key) ?? 0) + meal.totalCarb);
      fatByDay.set(key, (fatByDay.get(key) ?? 0) + meal.totalFat);
    }

    const loggedDays = caloriesByDay.size;
    const avgDailyCalories = loggedDays > 0 ? this.avg(Array.from(caloriesByDay.values())) : null;
    const avgDailyProtein = loggedDays > 0 ? this.avg(Array.from(proteinByDay.values())) : null;
    const avgDailyCarb = loggedDays > 0 ? this.avg(Array.from(carbByDay.values())) : null;
    const avgDailyFat = loggedDays > 0 ? this.avg(Array.from(fatByDay.values())) : null;

    // Compliance: % ngày đạt ≥80% target calo
    const targetCal = user.targetCalories ?? 2000;
    const compliantDays = Array.from(caloriesByDay.values()).filter((c) => c >= targetCal * 0.8).length;
    const compliancePct = loggedDays > 0 ? Math.round((compliantDays / loggedDays) * 100) : null;

    // Trend weight tại thời điểm check-in (lấy bản ghi mới nhất 7 ngày)
    const recentWeightLogs = await this.prisma.weightLog.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
    let trendWeight: number | null = null;
    if (recentWeightLogs.length > 0) {
      let t = recentWeightLogs[0].weightKg;
      for (let i = 1; i < recentWeightLogs.length; i++) {
        t = t + 0.1 * (recentWeightLogs[i].weightKg - t);
      }
      trendWeight = Math.round(t * 10) / 10;
    }

    // Tính lại Expenditure (AdaptiveExpenditureService)
    const expenditureResult = await this.expenditureService.recalculate(
      userId,
      user.tdee ?? null,
      user.adaptiveExpenditure ?? null,
    );
    const newExpenditure = expenditureResult.estimatedExpenditure;

    // C018: Raw Adjustment = newExpenditure − currentTarget, clamp ±10%
    const currentTarget = Math.round(user.targetCalories ?? 2000);
    let proposedCalorieTarget = currentTarget;
    let adjustmentReason: CheckInAdjustmentReason = CheckInAdjustmentReason.NO_CHANGE;

    if (newExpenditure && newExpenditure !== currentTarget) {
      const rawAdj = newExpenditure - currentTarget;
      const limit = currentTarget * SMOOTHING_LIMIT_RATIO;
      const clampedAdj = Math.min(Math.max(rawAdj, -limit), limit);
      const baseExpenditure = currentTarget + clampedAdj;

      // Áp lại goal deficit/surplus
      const rate = user.weightRateKgPerWeek ?? 0.5;
      const deltaPerDay = Math.round((rate * KCAL_PER_KG) / 7);
      if (user.goal === GoalType.LOSE_WEIGHT) {
        proposedCalorieTarget = Math.max(Math.round(baseExpenditure - deltaPerDay), 1200);
      } else if (user.goal === GoalType.GAIN_WEIGHT) {
        proposedCalorieTarget = Math.round(baseExpenditure + deltaPerDay);
      } else {
        proposedCalorieTarget = Math.round(baseExpenditure);
      }

      adjustmentReason =
        Math.abs(rawAdj) >= currentTarget * SMOOTHING_LIMIT_RATIO
          ? CheckInAdjustmentReason.SMOOTHING
          : CheckInAdjustmentReason.EXPENDITURE_CHANGE;
    }

    // Tính macro mới theo macroStyle hiện tại
    const macroStyle = user.macroStyle ?? MacroStyle.BALANCED;
    const proposedMacros = this.calcMacros(proposedCalorieTarget, macroStyle);
    const currentMacros = this.calcMacros(currentTarget, macroStyle);

    // Goal progress % — tái dùng đúng công thức (startWeight từ bản ghi log đầu tiên) đã có ở WeightLogsService
    const progressResult = await this.weightLogsService.getWeightProgress(userId);
    const goalProgressPct = progressResult.data.progressPercent;

    // Upsert check-in (nếu tuần này đã có thì cập nhật lại)
    const checkIn = await this.prisma.checkIn.upsert({
      where: { userId_weekStartDate: { userId, weekStartDate } },
      update: {
        avgDailyCalories,
        avgDailyProtein,
        avgDailyCarb,
        avgDailyFat,
        weightAtCheckin: trendWeight,
        compliancePct,
        currentCalorieTarget: currentTarget,
        proposedCalorieTarget,
        currentProteinTarget: user.targetProtein,
        proposedProteinTarget: proposedMacros.protein,
        currentCarbTarget: user.targetCarb,
        proposedCarbTarget: proposedMacros.carb,
        currentFatTarget: user.targetFat,
        proposedFatTarget: proposedMacros.fat,
        newExpenditure,
        adjustmentReason,
        goalProgressPct,
        status: 'PENDING',
        processedAt: null,
        ...(dto.mood ? { mood: dto.mood } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
      create: {
        userId,
        weekNumber,
        weekStartDate,
        weekEndDate,
        status: CheckInStatus.PENDING,
        avgDailyCalories,
        avgDailyProtein,
        avgDailyCarb,
        avgDailyFat,
        weightAtCheckin: trendWeight,
        compliancePct,
        currentCalorieTarget: currentTarget,
        proposedCalorieTarget,
        currentProteinTarget: user.targetProtein,
        proposedProteinTarget: proposedMacros.protein,
        currentCarbTarget: user.targetCarb,
        proposedCarbTarget: proposedMacros.carb,
        currentFatTarget: user.targetFat,
        proposedFatTarget: proposedMacros.fat,
        newExpenditure,
        adjustmentReason,
        goalProgressPct,
        ...(dto.mood ? { mood: dto.mood } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    // Tạo coaching module nội dung giải thích
    const coachingContent = this.buildCoachingModule(checkIn.adjustmentReason, {
      oldTarget: currentTarget,
      newTarget: proposedCalorieTarget,
      newExpenditure,
      compliancePct,
    });

    return {
      message: 'Check-in tuần đã được tạo thành công',
      data: { checkIn, coachingContent, currentMacros },
    };
  }

  /**
   * Lấy check-in đang chờ xử lý (PENDING hoặc DISMISSED gần nhất) của user.
   */
  async getPendingCheckin(userId: string) {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        userId,
        status: { in: [CheckInStatus.PENDING, CheckInStatus.DISMISSED] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!checkIn) {
      return { message: 'Không có check-in nào đang chờ xử lý', data: null };
    }

    const coachingContent = this.buildCoachingModule(checkIn.adjustmentReason, {
      oldTarget: checkIn.currentCalorieTarget,
      newTarget: checkIn.proposedCalorieTarget,
      newExpenditure: checkIn.newExpenditure,
      compliancePct: checkIn.compliancePct,
    });

    return { message: 'Lấy check-in thành công', data: { checkIn, coachingContent } };
  }

  /**
   * Accept / Decline / Dismiss một check-in.
   */
  async respondToCheckin(userId: string, checkinId: string, dto: RespondCheckinDto) {
    const checkIn = await this.prisma.checkIn.findFirst({ where: { id: checkinId, userId } });
    if (!checkIn) throw new NotFoundException('Không tìm thấy check-in');
    if (checkIn.status === CheckInStatus.ACCEPTED || checkIn.status === CheckInStatus.DECLINED) {
      throw new BadRequestException('Check-in này đã được xử lý rồi');
    }

    const now = new Date();

    if (dto.action === 'ACCEPT') {
      // Cập nhật target của user
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          targetCalories: checkIn.proposedCalorieTarget,
          targetProtein: checkIn.proposedProteinTarget,
          targetCarb: checkIn.proposedCarbTarget,
          targetFat: checkIn.proposedFatTarget,
          adaptiveExpenditure: checkIn.newExpenditure ?? undefined,
          expenditureUpdatedAt: now,
        },
      });

      const updated = await this.prisma.checkIn.update({
        where: { id: checkinId },
        data: {
          status: CheckInStatus.ACCEPTED,
          processedAt: now,
          ...(dto.mood ? { mood: dto.mood } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
      return { message: 'Đã chấp nhận đề xuất — mục tiêu dinh dưỡng đã được cập nhật', data: updated };
    }

    if (dto.action === 'DECLINE') {
      const updated = await this.prisma.checkIn.update({
        where: { id: checkinId },
        data: {
          status: CheckInStatus.DECLINED,
          processedAt: now,
          ...(dto.mood ? { mood: dto.mood } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
      return { message: 'Đã từ chối đề xuất — mục tiêu hiện tại vẫn giữ nguyên', data: updated };
    }

    // DISMISS
    const updated = await this.prisma.checkIn.update({
      where: { id: checkinId },
      data: {
        status: CheckInStatus.DISMISSED,
        ...(dto.mood ? { mood: dto.mood } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
    return { message: 'Check-in đã được hoãn lại — sẽ nhắc lại lần sau', data: updated };
  }

  /**
   * Lịch sử check-in của user.
   */
  async getCheckinHistory(userId: string, limit = 10) {
    const history = await this.prisma.checkIn.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { message: 'Lịch sử check-in', data: history };
  }

  /**
   * Chi tiết một check-in.
   */
  async getCheckinById(userId: string, checkinId: string) {
    const checkIn = await this.prisma.checkIn.findFirst({ where: { id: checkinId, userId } });
    if (!checkIn) throw new NotFoundException('Không tìm thấy check-in');

    const coachingContent = this.buildCoachingModule(checkIn.adjustmentReason, {
      oldTarget: checkIn.currentCalorieTarget,
      newTarget: checkIn.proposedCalorieTarget,
      newExpenditure: checkIn.newExpenditure,
      compliancePct: checkIn.compliancePct,
    });
    return { message: 'Chi tiết check-in', data: { checkIn, coachingContent } };
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private avg(values: number[]): number {
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  private calcMacros(calories: number, style: MacroStyle) {
    const ratios: Record<MacroStyle, [number, number, number]> = {
      BALANCED:          [0.3,  0.4,  0.3],
      HIGH_CARB_LOW_FAT: [0.3,  0.55, 0.15],
      LOW_CARB_HIGH_FAT: [0.35, 0.2,  0.45],
      KETO:              [0.25, 0.05, 0.70],
    };
    const [p, c, f] = ratios[style];
    return {
      protein: Math.round((calories * p) / 4),
      carb: Math.round((calories * c) / 4),
      fat: Math.round((calories * f) / 9),
    };
  }

  private getCurrentWeekRange(): { weekStartDate: Date; weekEndDate: Date; weekNumber: number } {
    const now = new Date();
    // Tuần bắt đầu Thứ 2, kết thúc Chủ Nhật (ISO week)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() + diffToMonday);
    weekStartDate.setHours(0, 0, 0, 0);

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);

    // weekNumber: tuần thứ N kể từ epoch (đơn giản)
    const weekNumber = Math.floor(weekStartDate.getTime() / (7 * 24 * 60 * 60 * 1000));

    return { weekStartDate, weekEndDate, weekNumber };
  }

  /**
   * Sinh nội dung giáo dục (Coaching Module) giải thích lý do thay đổi target.
   */
  private buildCoachingModule(
    reason: CheckInAdjustmentReason,
    ctx: {
      oldTarget: number;
      newTarget: number;
      newExpenditure: number | null;
      compliancePct: number | null;
    },
  ) {
    const delta = ctx.newTarget - ctx.oldTarget;
    const sign = delta > 0 ? '+' : '';
    const compliance = ctx.compliancePct ?? 0;

    const complianceMsg =
      compliance >= 80
        ? `Bạn đạt ${compliance}% ngày có đủ dưỡng chất — tuyệt vời! 🎉`
        : compliance >= 50
          ? `Bạn đạt ${compliance}% ngày đủ dưỡng chất — đang tiến bộ tốt.`
          : `Bạn đạt ${compliance}% ngày — hãy thử log bữa ăn đều đặn hơn để hệ thống tính chính xác hơn.`;

    let title = 'Đề xuất điều chỉnh mục tiêu tuần này';
    let explanation = '';

    switch (reason) {
      case CheckInAdjustmentReason.EXPENDITURE_CHANGE:
        explanation = `Dựa trên cân nặng và bữa ăn bạn đã log, hệ thống ước tính năng lượng tiêu hao thực tế của bạn là khoảng ${ctx.newExpenditure ? Math.round(ctx.newExpenditure) : '—'} kcal/ngày. Mức tiêu thụ thực tế thay đổi so với tuần trước, nên mục tiêu được điều chỉnh ${sign}${delta} kcal để bám sát mục tiêu của bạn.`;
        break;
      case CheckInAdjustmentReason.SMOOTHING:
        explanation = `Mức thay đổi tính toán được khá lớn, nhưng hệ thống giới hạn tối đa ±10%/tuần để tránh dao động đột ngột. Phần còn lại sẽ được điều chỉnh dần trong các tuần tới — đây là cách tiếp cận khoa học, giúp cơ thể thích nghi tốt hơn.`;
        break;
      case CheckInAdjustmentReason.GOAL_CHANGE:
        explanation = `Mục tiêu của bạn đã thay đổi, nên mức calo và macro được tính lại cho phù hợp.`;
        break;
      case CheckInAdjustmentReason.NO_CHANGE:
      default:
        title = 'Mục tiêu tuần này giữ nguyên';
        explanation = `Không có sự thay đổi đáng kể về năng lượng tiêu hao tuần qua — mục tiêu hiện tại vẫn phù hợp. Hãy tiếp tục duy trì thói quen tốt!`;
    }

    return {
      title,
      explanation,
      complianceMessage: complianceMsg,
      callToAction:
        delta !== 0
          ? `Chấp nhận mức điều chỉnh ${sign}${delta} kcal để cập nhật mục tiêu mới, hoặc từ chối để giữ nguyên ${ctx.oldTarget} kcal.`
          : 'Giữ nguyên mục tiêu hoặc ghi lại tâm trạng tuần qua.',
    };
  }
}
