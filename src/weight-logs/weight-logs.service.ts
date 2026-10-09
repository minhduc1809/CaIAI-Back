import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getActiveGoal, startGoal } from '../users/goal.util';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { AdaptiveExpenditureService } from '../users/adaptive-expenditure.service';
import {
  dayKeyOf,
  keyToDate,
  resolveTimezone,
} from '../common/utils/date-zone.util';
import { CreateWeightLogDto } from './dto/create-weight-log.dto';
import { UpdateWeightLogDto } from './dto/update-weight-log.dto';

@Injectable()
export class WeightLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthCalculator: HealthCalculatorService,
    private readonly adaptiveExpenditure: AdaptiveExpenditureService,
  ) {}

  /**
   * Ghi nhận cân nặng mới và tự động cập nhật lại Profile + BMI của User
   */
  async createLog(userId: string, dto: CreateWeightLogDto) {
    const { weightKg, note, date } = dto;
    const logDate = date ? new Date(date) : new Date();

    // 0. Cân nặng lệch nhiều so với xu hướng (nhầm kg/lb, cân sau bữa lớn) → đánh dấu để app hỏi lại.
    //    Chỉ đánh dấu, vẫn lưu bản ghi (BR-09.3; việc loại khỏi xu hướng thuộc BR-05.3).
    const suspicious = await this.isSuspiciousWeight(userId, weightKg);

    // 1. Tạo bản ghi WeightLog
    const log = await this.prisma.weightLog.create({
      data: {
        userId,
        weightKg,
        note: note || null,
        date: logDate,
      },
    });

    // 2. Cân hiện tại = bản ghi MỚI NHẤT THEO NGÀY (ghi bù ngày cũ không được ghi đè cân hiện tại)
    await this.refreshCurrentWeight(userId);

    return {
      message: 'Ghi nhận cân nặng thành công',
      data: { ...log, suspicious },
    };
  }

  /** Các lần cân gần nhất, trả về theo thứ tự thời gian tăng dần (cũ → mới). */
  private async latestLogsAscending(userId: string, limit: number) {
    const rows = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return [...rows].sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );
  }

  /**
   * Đồng bộ cân nặng hiện tại của hồ sơ với bản ghi mới nhất theo ngày, rồi tính lại các chỉ số suy ra.
   * Gọi sau MỌI thao tác thêm/sửa/xoá. Hết sạch bản ghi thì giữ cân hiện tại đã biết.
   *
   * BR-04 / BR-09.2: ghi cân KHÔNG được đổi mục tiêu calo/macro. Chỉ cập nhật cân hiện tại, các chỉ số
   * suy ra (BMI, BMR, TDEE tĩnh) và kết quả Adaptive Engine (ước tính, không phải mục tiêu).
   */
  private async refreshCurrentWeight(userId: string) {
    const latest = await this.prisma.weightLog.findFirst({
      where: { userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    if (!latest) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const weightKg = latest.weightKg;
    const staticCalculations = this.healthCalculator.calculateAllMetrics({
      heightCm: user.heightCm,
      weightKg,
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

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        weightKg,
        bmi: staticCalculations.bmi,
        bmr: staticCalculations.bmr,
        tdee: staticCalculations.tdee,
        adaptiveExpenditure: expenditureResult.estimatedExpenditure,
        expenditureStatus: expenditureResult.status,
        expenditureUpdatedAt: new Date(),
      },
    });

    await this.adaptiveExpenditure.recordSnapshot(userId, expenditureResult);
  }

  /**
   * Tính danh sách cân hợp lệ (BR-05.3 & BR-09.4):
   * 1. Gom nhiều lần cân trong cùng ngày theo múi giờ user thành TRUNG BÌNH ngày (D6).
   * 2. Lọc bỏ các ngày nghi ngờ ngoại lai (> max(2kg, 3%)) nếu chưa được xác nhận bởi lần cân trong vòng 3 ngày cùng hướng (lệch < 1kg) (D1).
   */
  async effectiveWeights(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = resolveTimezone(user?.timezone);

    const logs = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    if (!logs || logs.length === 0) return [];

    // 1. Gom nhóm theo ngày
    const dayMap = new Map<
      string,
      { date: Date; weights: number[]; ids: string[] }
    >();
    for (const log of logs) {
      const key = dayKeyOf(log.date, tz);
      const cur = dayMap.get(key) ?? { date: log.date, weights: [], ids: [] };
      cur.weights.push(log.weightKg);
      cur.ids.push(log.id);
      dayMap.set(key, cur);
    }

    const dayKeys = Array.from(dayMap.keys()).sort();
    const days = dayKeys.map((k) => {
      const d = dayMap.get(k)!;
      const avg = d.weights.reduce((sum, w) => sum + w, 0) / d.weights.length;
      return {
        dateKey: k,
        date: keyToDate(k),
        avgWeight: avg,
        ids: d.ids,
        isOutlier: false,
        confirmed: false,
      };
    });

    if (days.length === 0) return [];

    // 2. Thuật toán phát hiện ngoại lai và xác nhận trong 3 ngày
    let runningTrend = days[0].avgWeight;

    for (let i = 0; i < days.length; i++) {
      const current = days[i];
      if (i === 0) continue;

      if (current.confirmed) {
        runningTrend = runningTrend + 0.1 * (current.avgWeight - runningTrend);
        continue;
      }

      const threshold = Math.max(2.0, runningTrend * 0.03);
      const diff = Math.abs(current.avgWeight - runningTrend);

      if (diff > threshold) {
        // Nghi ngờ ngoại lai: Tìm trong 3 ngày kế tiếp xem có lần cân cùng hướng (lệch < 1kg) không
        let confirmed = false;
        const currentMs = current.date.getTime();
        for (let j = i + 1; j < days.length; j++) {
          const next = days[j];
          const daysDiff =
            (next.date.getTime() - currentMs) / (24 * 3600 * 1000);
          if (daysDiff > 3) break;

          if (Math.abs(next.avgWeight - current.avgWeight) < 1.0) {
            confirmed = true;
            next.confirmed = true;
            break;
          }
        }

        if (confirmed) {
          current.confirmed = true;
          runningTrend =
            runningTrend + 0.1 * (current.avgWeight - runningTrend);
        } else {
          current.isOutlier = true;
        }
      } else {
        runningTrend = runningTrend + 0.1 * (current.avgWeight - runningTrend);
      }
    }

    return days;
  }

  /**
   * Cân nặng bị coi là đáng ngờ khi lệch quá max(2 kg, 3% cân nặng) so với xu hướng EWMA hiện tại.
   */
  private async isSuspiciousWeight(
    userId: string,
    weightKg: number,
  ): Promise<boolean> {
    const days = await this.effectiveWeights(userId);
    const valid = days.filter((d) => !d.isOutlier);
    if (valid.length === 0) return false;

    let trend = valid[0].avgWeight;
    for (let i = 1; i < valid.length; i++) {
      trend = trend + 0.1 * (valid[i].avgWeight - trend);
    }
    const threshold = Math.max(2, trend * 0.03);
    return Math.abs(weightKg - trend) > threshold;
  }

  /**
   * Cập nhật bản ghi cân nặng
   */
  async updateLog(userId: string, logId: string, dto: UpdateWeightLogDto) {
    const existing = await this.prisma.weightLog.findUnique({
      where: { id: logId },
    });

    if (!existing) {
      throw new NotFoundException('Không tìm thấy bản ghi cân nặng');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền sửa bản ghi này');
    }

    const updated = await this.prisma.weightLog.update({
      where: { id: logId },
      data: {
        weightKg: dto.weightKg !== undefined ? dto.weightKg : existing.weightKg,
        note: dto.note !== undefined ? dto.note : existing.note,
        date: dto.date ? new Date(dto.date) : existing.date,
      },
    });

    await this.refreshCurrentWeight(userId);

    return {
      message: 'Cập nhật bản ghi cân nặng thành công',
      data: updated,
    };
  }

  /**
   * Lấy lịch sử cân nặng theo thứ tự thời gian (dùng vẽ biểu đồ Line Chart)
   */
  async getLogs(userId: string, limit: number = 30) {
    const logs = await this.latestLogsAscending(userId, limit);

    return {
      message: 'Lấy lịch sử cân nặng thành công',
      data: logs,
    };
  }

  /**
   * Tính toán xu hướng cân nặng làm mượt (Trend Weight - EWMA) theo chuẩn BRD
   * Sử dụng ngày cân trung bình và lọc ngoại lai (BR-05.3, BR-09.4)
   */
  async getWeightTrend(userId: string, limit: number = 60) {
    const days = await this.effectiveWeights(userId);
    const validDays = days.filter((d) => !d.isOutlier);

    if (validDays.length === 0) {
      return {
        message: 'Chưa có bản ghi cân nặng để tính xu hướng',
        data: [],
      };
    }

    const limited = validDays.slice(-limit);
    let previousTrend = limited[0].avgWeight;

    const trendData = limited.map((d, index) => {
      if (index === 0) {
        return {
          id: d.ids[0],
          date: d.dateKey,
          loggedWeight: Math.round(d.avgWeight * 10) / 10,
          trendWeight: Math.round(d.avgWeight * 10) / 10,
        };
      }

      const currentTrend = previousTrend + 0.1 * (d.avgWeight - previousTrend);
      previousTrend = currentTrend;

      return {
        id: d.ids[0],
        date: d.dateKey,
        loggedWeight: Math.round(d.avgWeight * 10) / 10,
        trendWeight: Math.round(currentTrend * 10) / 10,
      };
    });

    return {
      message: 'Tính toán xu hướng cân nặng (Trend Weight) thành công',
      data: trendData,
    };
  }

  /**
   * Thống kê tiến độ hoàn thành mục tiêu cân nặng (Start vs Current vs Target)
   */
  async getWeightProgress(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        weightKg: true,
        targetWeightKg: true,
        goal: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    // Mốc bắt đầu = startWeight của Goal đang hiệu lực (BR-09.5), không phải bản ghi cân cũ nhất mọi thời đại.
    // Người dùng cũ chưa có Goal (migration chỉ tạo cho người có mục tiêu) thì dùng bản ghi cân sớm nhất, như trước.
    let goalRow = await getActiveGoal(this.prisma, userId);
    if (!goalRow && user.goal && user.weightKg) {
      const earliest = await this.prisma.weightLog.findFirst({
        where: { userId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      goalRow = await startGoal(this.prisma, userId, {
        goalType: user.goal,
        startWeight: earliest?.weightKg ?? user.weightKg,
        targetWeight: user.targetWeightKg,
        startDate: earliest?.date,
      });
    }

    const startWeight = goalRow ? goalRow.startWeight : user.weightKg;
    const currentWeight = user.weightKg;
    const targetWeight = user.targetWeightKg;

    let progressPercent = 0;
    let weightChanged = 0;
    let remainingToGoal = 0;

    if (startWeight && currentWeight) {
      weightChanged = Math.round((currentWeight - startWeight) * 10) / 10;
    }

    if (currentWeight && targetWeight) {
      remainingToGoal =
        Math.round(Math.abs(currentWeight - targetWeight) * 10) / 10;

      if (startWeight && startWeight !== targetWeight) {
        const totalSpan = Math.abs(startWeight - targetWeight);
        const achievedSpan = Math.abs(currentWeight - startWeight);

        // Kiểm tra xem có đang đi đúng hướng không
        const goalType = goalRow?.goalType ?? user.goal;
        const isLosing =
          goalType === 'LOSE_WEIGHT' && currentWeight <= startWeight;
        const isGaining =
          goalType === 'GAIN_WEIGHT' && currentWeight >= startWeight;

        if (isLosing || isGaining) {
          progressPercent = Math.min(
            100,
            Math.round((achievedSpan / totalSpan) * 100),
          );
        }
      }
    }

    return {
      message: 'Lấy tiến độ cân nặng thành công',
      data: {
        goal: user.goal,
        startWeightKg: startWeight,
        goalStartDate: goalRow?.startDate ?? null,
        currentWeightKg: currentWeight,
        targetWeightKg: targetWeight,
        weightChangedKg: weightChanged,
        remainingToGoalKg: remainingToGoal,
        progressPercent,
      },
    };
  }

  /**
   * Xóa một bản ghi log cân nặng
   */
  async deleteLog(userId: string, logId: string) {
    const log = await this.prisma.weightLog.findUnique({
      where: { id: logId },
    });

    if (!log) {
      throw new NotFoundException('Không tìm thấy bản ghi cân nặng');
    }

    if (log.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xóa bản ghi này');
    }

    await this.prisma.weightLog.delete({
      where: { id: logId },
    });

    await this.refreshCurrentWeight(userId);

    return {
      message: 'Xóa bản ghi cân nặng thành công',
    };
  }
}
