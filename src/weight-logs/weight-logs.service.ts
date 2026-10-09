import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getActiveGoal, startGoal } from '../users/goal.util';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { AdaptiveExpenditureService } from '../users/adaptive-expenditure.service';
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
   * Cân nặng bị coi là đáng ngờ khi lệch quá max(2 kg, 3% cân nặng) so với xu hướng EWMA hiện tại.
   * Chưa có lịch sử thì không đáng ngờ.
   */
  private async isSuspiciousWeight(
    userId: string,
    weightKg: number,
  ): Promise<boolean> {
    const previous = await this.latestLogsAscending(userId, 60);
    if (!previous || previous.length === 0) return false;
    let trend = previous[0].weightKg;
    for (let i = 1; i < previous.length; i++) {
      trend = trend + 0.1 * (previous[i].weightKg - trend);
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
    // Lấy các lần cân GẦN NHẤT (trước đây lấy nhầm các lần cũ nhất khi có nhiều hơn `limit` bản ghi)
    const logs = await this.latestLogsAscending(userId, limit);

    return {
      message: 'Lấy lịch sử cân nặng thành công',
      data: logs,
    };
  }

  /**
   * Tính toán xu hướng cân nặng làm mượt (Trend Weight - EWMA) theo chuẩn BRD
   * Công thức: TrendWeight_t = TrendWeight_{t-1} + 0.1 * (LoggedWeight_t - TrendWeight_{t-1})
   */
  async getWeightTrend(userId: string, limit: number = 60) {
    const logs = await this.latestLogsAscending(userId, limit);

    if (logs.length === 0) {
      return {
        message: 'Chưa có bản ghi cân nặng để tính xu hướng',
        data: [],
      };
    }

    let previousTrend = logs[0].weightKg;
    const trendData = logs.map((log, index) => {
      if (index === 0) {
        return {
          id: log.id,
          date: log.date.toISOString().split('T')[0],
          loggedWeight: log.weightKg,
          trendWeight: Math.round(log.weightKg * 10) / 10,
          note: log.note,
        };
      }

      // Hệ số làm mượt alpha = 0.1 theo chuẩn MacroFactor / BRD Nutrition AI
      const currentTrend = previousTrend + 0.1 * (log.weightKg - previousTrend);
      previousTrend = currentTrend;

      return {
        id: log.id,
        date: log.date.toISOString().split('T')[0],
        loggedWeight: log.weightKg,
        trendWeight: Math.round(currentTrend * 10) / 10,
        note: log.note,
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
