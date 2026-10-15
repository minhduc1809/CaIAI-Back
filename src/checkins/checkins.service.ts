import { cfg, configVersion } from '../system-config/config.holder';
import { isFreeTierLimited } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdaptiveExpenditureService,
  ENGINE_MIN_LOGGED_DAYS,
  ENGINE_MIN_WEIGHT_DAYS,
} from '../users/adaptive-expenditure.service';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import {
  CheckInStatus,
  CheckInAdjustmentReason,
  MacroStyle,
  ProgramType,
  GoalType,
} from '@prisma/client';
import { RespondCheckinDto } from './dto/respond-checkin.dto';
import { CreateCheckinDto } from './dto/create-checkin.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  addDaysToKey,
  dateToKey,
  dayBoundsForKey,
  keyToDate,
  dayKeyOf,
  resolveTimezone,
  todayKey,
  weekdayOnOrAfter,
  weekdayOnOrBefore,
  zonedMidnight,
} from '../common/utils/date-zone.util';
import {
  isCompleteDay,
  loadDayFlags,
} from '../common/utils/day-completeness.util';

/** Guardrail smoothing ±10%/tuần (C018) */
const smoothingLimitRatio = () => cfg('checkin.maxChangePct') / 100;
const KCAL_PER_KG = 7700;
/** "Để sau": sau chừng này giờ Check-in tự quay lại danh sách chờ. */
const snoozeHours = () => cfg('checkin.snoozeHours');
/** Chênh lệch nhỏ hơn mức này (kcal) được coi là không đổi. */
const noChangeThresholdKcal = () => cfg('checkin.noChangeThresholdKcal');
/** Dynamic Maintenance: chỉ chỉnh khi lệch khỏi cân đích quá ngưỡng này (kg). */
const maintainToleranceKg = () => cfg('checkin.maintainToleranceKg');
/** Dynamic Maintenance: mức bù mỗi tuần theo % cân nặng. */
const maintainNudgePctPerWeek = () => cfg('checkin.maintainNudgePctPerWeek');

@Injectable()
export class CheckinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenditureService: AdaptiveExpenditureService,
    private readonly healthCalc: HealthCalculatorService,
    private readonly weightLogsService: WeightLogsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Tạo/cập nhật check-in cho tuần hiện tại.
   * Mọi người dùng đều có Check-in; Free được 1 Check-in/tháng, Premium hằng tuần (xem assertCheckinQuota).
   * Nếu đã tồn tại check-in PENDING/SNOOZED trong tuần này → cập nhật lại dữ liệu.
   */
  async generateCheckin(userId: string, dto: CreateCheckinDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    // BR-06.2: kỳ dữ liệu = 7 ngày ĐÃ HOÀN TẤT kết thúc trước ngày Check-in (Thứ Hai), theo múi giờ user.
    // Tạo Check-in vào bất kỳ ngày nào trong tuần cũng dùng đúng 7 ngày trọn vẹn của tuần trước.
    const tz = resolveTimezone(user.timezone);
    const checkinDay = user.checkinDay ?? 1;
    const { startKey, lastKey, weekStartDate, weekEndDate, weekNumber } =
      this.getCompletedPeriod(tz, user.createdAt, checkinDay);
    const nextCheckinDate = this.nextCheckinKey(tz, checkinDay);

    // BR-06.3: Check-in dùng 7 ngày trọn vẹn của kỳ trước. Tài khoản chưa có đủ một kỳ như vậy thì chưa có Check-in
    // (thay vì tạo ngay một Check-in rỗng "thiếu dữ liệu" trong ngày đầu dùng app).
    const createdKey = user.createdAt ? dayKeyOf(user.createdAt, tz) : null;
    if (createdKey && startKey < createdKey) {
      return {
        message: 'Check-in đầu tiên của bạn chưa tới',
        data: {
          checkIn: null,
          coachingContent: null,
          nextCheckinDate: this.firstCheckinKey(createdKey, checkinDay),
          checkinDay,
          tooEarly: true,
        },
      };
    }

    // BR-06.6: mỗi kỳ chỉ có một Check-in. Đã có thì trả lại nguyên trạng (không tính lại, không mở lại
    // Check-in đã xử lý). Check-in chờ của kỳ trước chuyển sang EXPIRED để tại mọi thời điểm chỉ có tối đa một.
    await this.prisma.checkIn.updateMany({
      where: {
        userId,
        weekStartDate: { lt: weekStartDate },
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SNOOZED] },
      },
      data: { status: CheckInStatus.EXPIRED, processedAt: new Date() },
    });
    const existing = await this.prisma.checkIn.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate } },
    });
    if (existing) {
      return this.presentExisting(existing, nextCheckinDate, checkinDay);
    }
    // Đổi ngày Check-in giữa chừng làm kỳ mới chồng lên kỳ của Check-in đã có: trả lại Check-in đó, không tạo thêm
    const overlapping = await this.prisma.checkIn.findFirst({
      where: { userId, weekEndDate: { gte: weekStartDate } },
      orderBy: { weekEndDate: 'desc' },
    });
    if (overlapping) {
      return this.presentExisting(overlapping, nextCheckinDate, checkinDay);
    }

    // Free: 1 Check-in/tháng (đặc tả 2.9). Check-in đã có của kỳ này được trả lại ở trên nên không tính lại.
    await this.assertCheckinQuota(userId, tz);

    const meals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: { gte: keyToDate(startKey), lte: keyToDate(lastKey) },
      },
      select: {
        logDate: true,
        totalCalories: true,
        totalProtein: true,
        totalCarb: true,
        totalFat: true,
      },
    });

    interface DayTotals {
      meals: number;
      calories: number;
      protein: number;
      carb: number;
      fat: number;
    }
    const byDay = new Map<string, DayTotals>();
    for (const meal of meals) {
      const key = dateToKey(meal.logDate);
      const cur = byDay.get(key) ?? {
        meals: 0,
        calories: 0,
        protein: 0,
        carb: 0,
        fat: 0,
      };
      cur.meals += 1;
      cur.calories += meal.totalCalories;
      cur.protein += meal.totalProtein;
      cur.carb += meal.totalCarb;
      cur.fat += meal.totalFat;
      byDay.set(key, cur);
    }

    // Chỉ ngày ĐẦY ĐỦ mới tính vào trung bình và mức tuân thủ (BR-05.2, BR-06.5)
    if (!user.targetCalories) throw new ProfileIncompleteException();
    const targetCal = user.targetCalories;
    const flags = await loadDayFlags(this.prisma, userId, startKey, lastKey);
    const completeDays = [...byDay.entries()]
      .filter(([key, d]) =>
        isCompleteDay(d.meals, d.calories, targetCal, flags.get(key)),
      )
      .map(([, d]) => d);
    const loggedDays = completeDays.length;
    const avgDailyCalories =
      loggedDays > 0 ? this.avg(completeDays.map((d) => d.calories)) : null;
    const avgDailyProtein =
      loggedDays > 0 ? this.avg(completeDays.map((d) => d.protein)) : null;
    const avgDailyCarb =
      loggedDays > 0 ? this.avg(completeDays.map((d) => d.carb)) : null;
    const avgDailyFat =
      loggedDays > 0 ? this.avg(completeDays.map((d) => d.fat)) : null;

    // BR-06.5: tuân thủ = % ngày đầy đủ có calo trong khoảng 85–115% mục tiêu (hai chiều, cùng ngưỡng Week Strip)
    const compliantDays = completeDays.filter(
      (d) => d.calories >= targetCal * 0.85 && d.calories <= targetCal * 1.15,
    ).length;
    const compliancePct =
      loggedDays > 0 ? Math.round((compliantDays / loggedDays) * 100) : null;

    // Trend weight: EWMA các lần cân trong kỳ dữ liệu
    const recentWeightLogs = await this.prisma.weightLog.findMany({
      where: {
        userId,
        date: {
          gte: dayBoundsForKey(startKey, tz).start,
          lt: dayBoundsForKey(lastKey, tz).end,
        },
      },
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
    );
    const newExpenditure = expenditureResult.estimatedExpenditure;

    // BR-06.4: ideal = calo mục tiêu tính từ Expenditure MỚI (E − D khi giảm, E + D khi tăng,
    // Dynamic Maintenance khi duy trì). Sau đó mới chặn ±10% so với mục tiêu hiện tại.
    // Không trừ thâm hụt lần nữa lên giá trị đã bị chặn (lỗi cũ: 2000/2550 → 1650 thay vì 2000).
    if (!user.targetCalories) throw new ProfileIncompleteException();
    const currentTarget = Math.round(user.targetCalories);
    let proposedCalorieTarget = currentTarget;
    let adjustmentReason: CheckInAdjustmentReason =
      CheckInAdjustmentReason.NO_CHANGE;

    if (newExpenditure) {
      let ideal: number | null;
      if (user.goal === GoalType.MAINTAIN) {
        ideal = this.dynamicMaintenance(
          newExpenditure,
          trendWeight,
          user.targetWeightKg,
        );
      } else {
        ideal = this.healthCalc.calculateTargetFromEnergy(
          newExpenditure,
          user.goal,
          user.weightRateKgPerWeek,
          { gender: user.gender, bmr: user.bmr },
        ).calories;
      }

      if (ideal !== null) {
        const minAllowed = currentTarget * (1 - smoothingLimitRatio());
        const maxAllowed = currentTarget * (1 + smoothingLimitRatio());
        const clamped = Math.round(
          Math.min(Math.max(ideal, minAllowed), maxAllowed),
        );
        proposedCalorieTarget = clamped;

        if (Math.abs(clamped - currentTarget) < noChangeThresholdKcal()) {
          proposedCalorieTarget = currentTarget;
          adjustmentReason = CheckInAdjustmentReason.NO_CHANGE;
        } else if (clamped !== Math.round(ideal)) {
          adjustmentReason = CheckInAdjustmentReason.SMOOTHING;
        } else {
          adjustmentReason = CheckInAdjustmentReason.EXPENDITURE_CHANGE;
        }
      }
    }

    // Macro hiện tại là mục tiêu đang dùng của user. Macro đề xuất: không đổi calo thì giữ nguyên macro hiện tại
    // (Check-in không được âm thầm đổi macro), đổi calo thì tính lại bằng đúng công thức của hồ sơ (đạm theo g/kg
    // BR-03.4, chia béo/tinh bột theo phong cách BR-03.5) với calo đề xuất.
    const macroStyle = user.macroStyle ?? MacroStyle.BALANCED;
    const currentMacros = {
      protein: user.targetProtein,
      carb: user.targetCarb,
      fat: user.targetFat,
    };
    const proposedMacros =
      proposedCalorieTarget === currentTarget
        ? currentMacros
        : this.healthCalc.calculateMacros(proposedCalorieTarget, macroStyle, {
            weightKg: trendWeight ?? user.weightKg,
            heightCm: user.heightCm,
            gender: user.gender,
            goal: user.goal,
            proteinPreference: user.proteinPreference,
            bodyFatPercent: user.bodyFatPercent,
          });

    // Goal progress % — tái dùng đúng công thức (startWeight từ bản ghi log đầu tiên) đã có ở WeightLogsService
    const progressResult =
      await this.weightLogsService.getWeightProgress(userId);
    const goalProgressPct = progressResult.data.progressPercent;

    // Engine chưa đủ dữ liệu (đang dùng TDEE tĩnh): chỉ ghi lý do và việc cần làm, KHÔNG có đề xuất
    const insufficientData = expenditureResult.method !== 'ADAPTIVE';
    if (insufficientData) {
      proposedCalorieTarget = currentTarget;
      adjustmentReason = CheckInAdjustmentReason.NO_CHANGE;
    }
    const finalMacros = insufficientData ? currentMacros : proposedMacros;

    const data = {
      userId,
      weekNumber,
      weekStartDate,
      weekEndDate,
      status: insufficientData
        ? CheckInStatus.INSUFFICIENT_DATA
        : CheckInStatus.PENDING,
      avgDailyCalories,
      avgDailyProtein,
      avgDailyCarb,
      avgDailyFat,
      weightAtCheckin: trendWeight,
      compliancePct,
      currentCalorieTarget: currentTarget,
      proposedCalorieTarget,
      currentProteinTarget: user.targetProtein,
      proposedProteinTarget: finalMacros.protein,
      currentCarbTarget: user.targetCarb,
      proposedCarbTarget: finalMacros.carb,
      currentFatTarget: user.targetFat,
      proposedFatTarget: finalMacros.fat,
      newExpenditure,
      adjustmentReason,
      goalProgressPct,
      completeDays: loggedDays,
      ...(insufficientData
        ? {
            dataNeeds: this.buildDataNeeds(
              expenditureResult.message,
              loggedDays,
              expenditureResult.weightLogsCount,
            ),
          }
        : {}),
      ...(dto.mood ? { mood: dto.mood } : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
    };

    let checkIn;
    try {
      // Phiên bản tham số lúc tính, để biết Check-in này dùng bộ tham số nào (BR-19.2 điều 7)
      checkIn = await this.prisma.checkIn.create({ data: { ...data, configVersion: configVersion() } });
    } catch (e) {
      // Hai request tạo cùng lúc: request sau vi phạm unique (userId, kỳ) → trả bản đã có
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      const winner = await this.prisma.checkIn.findUnique({
        where: { userId_weekStartDate: { userId, weekStartDate } },
      });
      if (!winner) throw e;
      return this.presentExisting(winner, nextCheckinDate, checkinDay);
    }

    // BR-13.1: báo cho người dùng biết Check-in đã sẵn sàng (không làm hỏng việc tạo Check-in nếu lỗi)
    try {
      await this.notificationsService.create(
        userId,
        'CHECKIN_READY',
        'Check-in tuần của bạn đã sẵn sàng',
        insufficientData
          ? 'Tuần này chưa đủ dữ liệu để đề xuất. Xem việc cần làm để Check-in chính xác hơn.'
          : 'NutriWise có đề xuất điều chỉnh mục tiêu dựa trên tuần vừa qua. Hãy xem và quyết định.',
      );
    } catch {
      // thông báo chỉ là phụ trợ
    }

    // Tạo coaching module nội dung giải thích
    const coachingContent = this.buildCoachingModule(checkIn.adjustmentReason, {
      oldTarget: currentTarget,
      newTarget: proposedCalorieTarget,
      newExpenditure,
      compliancePct,
      status: checkIn.status,
      dataNeeds: checkIn.dataNeeds,
    });

    return {
      message: 'Check-in tuần đã được tạo thành công',
      data: {
        checkIn,
        coachingContent,
        currentMacros,
        nextCheckinDate,
        checkinDay,
      },
    };
  }

  /**
   * Lấy check-in đang chờ xử lý (PENDING hoặc SNOOZED gần nhất) của user.
   */
  /**
   * Hạn mức Check-in theo gói: Free 1 lần mỗi tháng dương lịch (theo múi giờ user), Premium hằng tuần (mỗi kỳ
   * đã tối đa một Check-in nên không cần đếm thêm). Chỉ áp dụng khi BILLING_ENFORCE=true.
   */
  private async assertCheckinQuota(userId: string, tz: string) {
    if (!(await isFreeTierLimited(this.prisma, userId))) return;
    const limit = PLAN_LIMITS.FREE.checkinPerMonth ?? 1;
    const [y, m] = todayKey(tz).split('-').map(Number);
    const start = zonedMidnight(y, m, 1, tz);
    const resetsAt = zonedMidnight(y, m + 1, 1, tz);
    const used = await this.prisma.checkIn.count({
      where: { userId, createdAt: { gte: start, lt: resetsAt } },
    });
    if (used >= limit) {
      throw new QuotaExceededException({
        feature: 'WEEKLY_CHECKIN',
        limit,
        used,
        period: 'month',
        resetsAt,
        premiumBenefit:
          'Mở Premium để Check-in hằng tuần và theo dõi lịch sử điều chỉnh.',
        isPremium: false,
      });
    }
  }

  async getPendingCheckin(userId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, checkinDay: true },
    });
    const checkinDay = owner?.checkinDay ?? 1;
    const nextCheckinDate = this.nextCheckinKey(
      resolveTimezone(owner?.timezone),
      checkinDay,
    );
    // "Để sau" tự quay lại PENDING sau 24 giờ
    await this.prisma.checkIn.updateMany({
      where: {
        userId,
        status: CheckInStatus.SNOOZED,
        processedAt: { lte: new Date(Date.now() - snoozeHours() * 3_600_000) },
      },
      data: { status: CheckInStatus.PENDING },
    });

    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        userId,
        status: {
          in: [CheckInStatus.PENDING, CheckInStatus.INSUFFICIENT_DATA],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!checkIn) {
      return {
        message: 'Không có check-in nào đang chờ xử lý',
        data: {
          checkIn: null,
          coachingContent: null,
          nextCheckinDate,
          checkinDay,
        },
      };
    }
    return {
      message: 'Lấy check-in thành công',
      data: { ...this.coaching(checkIn), nextCheckinDate, checkinDay },
    };
  }

  private coaching(checkIn: {
    status?: CheckInStatus;
    adjustmentReason: CheckInAdjustmentReason;
    currentCalorieTarget: number;
    proposedCalorieTarget: number;
    newExpenditure: number | null;
    compliancePct: number | null;
    dataNeeds?: unknown;
  }) {
    return {
      checkIn,
      coachingContent: this.buildCoachingModule(checkIn.adjustmentReason, {
        oldTarget: checkIn.currentCalorieTarget,
        newTarget: checkIn.proposedCalorieTarget,
        newExpenditure: checkIn.newExpenditure,
        compliancePct: checkIn.compliancePct,
        status: checkIn.status,
        dataNeeds: checkIn.dataNeeds,
      }),
    };
  }

  private presentExisting(
    checkIn: any,
    nextCheckinDate?: string,
    checkinDay?: number,
  ) {
    return {
      message: 'Check-in của kỳ này đã tồn tại',
      data: {
        ...this.coaching(checkIn),
        currentMacros: undefined,
        nextCheckinDate,
        checkinDay,
      },
    };
  }

  /**
   * Accept / Decline / Dismiss một check-in.
   */
  async respondToCheckin(
    userId: string,
    checkinId: string,
    dto: RespondCheckinDto,
  ) {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: { id: checkinId, userId },
    });
    if (!checkIn) throw new NotFoundException('Không tìm thấy check-in');
    const finalStates: CheckInStatus[] = [
      CheckInStatus.ACCEPTED,
      CheckInStatus.DECLINED,
      CheckInStatus.EXPIRED,
      CheckInStatus.ACKNOWLEDGED,
    ];
    if (finalStates.includes(checkIn.status)) {
      throw new BadRequestException('Check-in này đã được xử lý rồi');
    }

    // Check-in thiếu dữ liệu không có đề xuất: chỉ có thể bấm "Đã hiểu"
    if (checkIn.status === CheckInStatus.INSUFFICIENT_DATA) {
      if (dto.action !== 'ACKNOWLEDGE') {
        throw new BadRequestException(
          'Check-in này chưa có đề xuất vì thiếu dữ liệu, chỉ có thể chọn "Đã hiểu"',
        );
      }
      const acknowledged = await this.prisma.checkIn.update({
        where: { id: checkinId },
        data: {
          status: CheckInStatus.ACKNOWLEDGED,
          processedAt: new Date(),
          ...(dto.mood ? { mood: dto.mood } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
      return { message: 'Đã ghi nhận', data: acknowledged };
    }
    if (dto.action === 'ACKNOWLEDGE') {
      throw new BadRequestException(
        'Chỉ Check-in thiếu dữ liệu mới dùng "Đã hiểu"',
      );
    }

    const now = new Date();

    if (dto.action === 'ACCEPT') {
      // Mục tiêu đã đổi (đổi mục tiêu, tính lại hồ sơ, tự đặt...) kể từ lúc tạo đề xuất → đề xuất hết giá trị
      const currentUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { targetCalories: true },
      });
      if (
        currentUser?.targetCalories != null &&
        Math.round(currentUser.targetCalories) !== checkIn.currentCalorieTarget
      ) {
        await this.prisma.checkIn.update({
          where: { id: checkinId },
          data: { status: CheckInStatus.EXPIRED, processedAt: now },
        });
        throw new ConflictException(
          'Mục tiêu đã thay đổi, đề xuất này không còn phù hợp',
        );
      }

      // Cập nhật target của user
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          targetCalories: checkIn.proposedCalorieTarget,
          targetProtein: checkIn.proposedProteinTarget,
          targetCarb: checkIn.proposedCarbTarget,
          targetFat: checkIn.proposedFatTarget,
          adaptiveExpenditure: checkIn.newExpenditure ?? undefined,
          expenditureUpdatedAt: now,
        },
        select: { tdee: true, expenditureStatus: true },
      });

      await this.prisma.targetChange.create({
        data: {
          userId,
          source: 'CHECKIN_ACCEPTED',
          oldCalories: checkIn.currentCalorieTarget,
          newCalories: checkIn.proposedCalorieTarget,
          oldMacros: {
            protein: checkIn.currentProteinTarget,
            carb: checkIn.currentCarbTarget,
            fat: checkIn.currentFatTarget,
          },
          newMacros: {
            protein: checkIn.proposedProteinTarget,
            carb: checkIn.proposedCarbTarget,
            fat: checkIn.proposedFatTarget,
          },
          checkinId: checkIn.id,
        },
      });

      await this.expenditureService.recordSnapshot(userId, {
        estimatedExpenditure: checkIn.newExpenditure,
        staticTdee: updatedUser.tdee,
        status: updatedUser.expenditureStatus as 'UPDATING' | 'HOLDING',
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
      return {
        message: 'Đã chấp nhận đề xuất — mục tiêu dinh dưỡng đã được cập nhật',
        data: updated,
      };
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
      return {
        message: 'Đã từ chối đề xuất — mục tiêu hiện tại vẫn giữ nguyên',
        data: updated,
      };
    }

    // SNOOZE (tên cũ: DISMISS): hoãn 24 giờ
    const updated = await this.prisma.checkIn.update({
      where: { id: checkinId },
      data: {
        status: CheckInStatus.SNOOZED,
        processedAt: now,
        ...(dto.mood ? { mood: dto.mood } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
    return {
      message: 'Check-in đã được hoãn lại — sẽ nhắc lại lần sau',
      data: updated,
    };
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
    const checkIn = await this.prisma.checkIn.findFirst({
      where: { id: checkinId, userId },
    });
    if (!checkIn) throw new NotFoundException('Không tìm thấy check-in');

    const coachingContent = this.buildCoachingModule(checkIn.adjustmentReason, {
      oldTarget: checkIn.currentCalorieTarget,
      newTarget: checkIn.proposedCalorieTarget,
      newExpenditure: checkIn.newExpenditure,
      compliancePct: checkIn.compliancePct,
      status: checkIn.status,
      dataNeeds: checkIn.dataNeeds,
    });
    return { message: 'Chi tiết check-in', data: { checkIn, coachingContent } };
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  /**
   * Dynamic Maintenance (BR-06.4): người duy trì lệch khỏi cân đích > 0.7 kg thì nhích calo nhẹ
   * để kéo về; còn lại giữ đúng Expenditure.
   */
  private dynamicMaintenance(
    expenditure: number,
    trendWeight: number | null,
    targetWeightKg: number | null | undefined,
  ): number {
    if (trendWeight === null || !targetWeightKg) return Math.round(expenditure);
    const diff = trendWeight - targetWeightKg;
    if (Math.abs(diff) <= maintainToleranceKg()) return Math.round(expenditure);
    const nudge =
      ((maintainNudgePctPerWeek() / 100) * trendWeight * KCAL_PER_KG) / 7;
    return Math.round(expenditure - Math.sign(diff) * nudge);
  }

  private stepsOf(dataNeeds: unknown): string[] {
    const steps = (dataNeeds as { steps?: unknown } | null)?.steps;
    return Array.isArray(steps)
      ? steps.filter((x): x is string => typeof x === 'string')
      : [];
  }

  private avg(values: number[]): number {
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }

  /** Ngày Check-in kế tiếp: lần gần nhất SAU hôm nay rơi vào `checkinDay`. */
  private nextCheckinKey(tz: string, checkinDay: number): string {
    return weekdayOnOrAfter(addDaysToKey(todayKey(tz), 1), checkinDay);
  }

  /** Ngày Check-in đầu tiên: kỳ 7 ngày đầu tiên nằm trọn trong thời gian có tài khoản (không sớm hơn createdKey + 7). */
  private firstCheckinKey(createdKey: string, checkinDay: number): string {
    return weekdayOnOrAfter(addDaysToKey(createdKey, 7), checkinDay);
  }

  /**
   * Việc cần làm cụ thể khi chưa đủ dữ liệu để đề xuất (BR-06.3). Lấy lý do thật từ engine thay vì câu chung chung,
   * cộng số ngày ghi đủ của kỳ vừa qua.
   */
  private buildDataNeeds(
    engineMessage: string | undefined,
    loggedDays: number,
    weighInDays: number | undefined,
  ) {
    const steps: string[] = [];
    const reason = (engineMessage ?? '')
      .replace(/\s*Hiện đang dùng công thức TDEE tĩnh\.?/i, '')
      .trim();
    if (reason) steps.push(reason);
    if (loggedDays < ENGINE_MIN_LOGGED_DAYS) {
      steps.push(
        `Tuần vừa qua bạn có ${loggedDays}/7 ngày ghi đủ bữa ăn. Hãy ghi đủ ít nhất ${ENGINE_MIN_LOGGED_DAYS} ngày mỗi tuần.`,
      );
    }
    if (steps.length === 0) {
      steps.push(
        'Hãy tiếp tục ghi bữa ăn và cân nặng đều đặn để hệ thống ước tính chính xác hơn.',
      );
    }
    return {
      steps,
      loggedDays,
      requiredLoggedDays: ENGINE_MIN_LOGGED_DAYS,
      weighInDays: weighInDays ?? 0,
      requiredWeighInDays: ENGINE_MIN_WEIGHT_DAYS,
    };
  }

  /**
   * Kỳ dữ liệu của Check-in (BR-06.2): 7 ngày đã hoàn tất, từ Thứ Hai tuần trước đến Chủ Nhật tuần trước
   * (ngày Check-in mặc định là Thứ Hai; nếu hôm nay là Thứ Hai thì kỳ kết thúc ngay hôm qua).
   */
  private getCompletedPeriod(
    tz: string,
    userCreatedAt?: Date | null,
    checkinDay = 1,
  ): {
    startKey: string;
    lastKey: string;
    weekStartDate: Date;
    weekEndDate: Date;
    weekNumber: number;
  } {
    const checkinKey = weekdayOnOrBefore(todayKey(tz), checkinDay);
    const startKey = addDaysToKey(checkinKey, -7);
    const lastKey = addDaysToKey(checkinKey, -1);
    const weekStartDate = keyToDate(startKey);
    const weekEndDate = new Date(keyToDate(lastKey).getTime() + 86_399_999);
    // weekNumber: tuần thứ N kể từ khi người dùng tạo tài khoản (tuần đầu = 1)
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekNumber = userCreatedAt
      ? Math.max(
          1,
          Math.floor((weekStartDate.getTime() - userCreatedAt.getTime()) / weekMs) + 1,
        )
      : 1;
    return { startKey, lastKey, weekStartDate, weekEndDate, weekNumber };
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
      status?: CheckInStatus;
      dataNeeds?: unknown;
    },
  ) {
    // Chưa đủ dữ liệu: không có đề xuất nên không được nói "mục tiêu giữ nguyên vì năng lượng không đổi"
    if (ctx.status === CheckInStatus.INSUFFICIENT_DATA) {
      return {
        title: 'Chưa đủ dữ liệu để đề xuất',
        explanation:
          'Hệ thống cần thêm dữ liệu để ước tính chính xác năng lượng bạn tiêu hao. Mục tiêu hiện tại của bạn vẫn được giữ nguyên.',
        complianceMessage:
          'Ghi đủ các bữa ăn trong ngày và cân đều đặn vài lần mỗi tuần để lần Check-in sau có đề xuất.',
        callToAction: 'Bấm "Đã hiểu" để tiếp tục.',
        todo: this.stepsOf(ctx.dataNeeds),
      };
    }
    const delta = ctx.newTarget - ctx.oldTarget;
    const sign = delta > 0 ? '+' : '';
    const compliance = ctx.compliancePct ?? 0;

    const complianceMsg =
      compliance >= 80
        ? `Bạn đạt ${compliance}% ngày có đủ dưỡng chất — tuyệt vời!`
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
