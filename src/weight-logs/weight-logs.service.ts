import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

    // 1. Tạo bản ghi WeightLog
    const log = await this.prisma.weightLog.create({
      data: {
        userId,
        weightKg,
        note: note || null,
        date: logDate,
      },
    });

    // 2. Lấy thông tin user hiện tại để tính lại BMI/BMR/TDEE với cân nặng mới
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      // 2a. Tính TDEE công thức tĩnh trước (làm baseline & sanity bound cho Adaptive Engine)
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

      // 2b. Adaptive Expenditure Engine — hồi quy dữ liệu cân nặng + calo đã log thực tế
      const expenditureResult = await this.adaptiveExpenditure.recalculate(
        userId,
        staticCalculations.tdee,
        user.adaptiveExpenditure,
      );

      // 2c. Tính lại Target Calories/Macro dựa trên Expenditure thích ứng (nếu có) thay vì TDEE tĩnh
      const finalCalculations = this.healthCalculator.calculateAllMetrics({
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
        expenditureOverride: expenditureResult.method === 'ADAPTIVE' ? expenditureResult.estimatedExpenditure : null,
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          weightKg,
          bmi: finalCalculations.bmi,
          bmr: finalCalculations.bmr,
          tdee: finalCalculations.tdee,
          targetCalories: finalCalculations.targetCalories,
          targetProtein: finalCalculations.targetProtein,
          targetCarb: finalCalculations.targetCarb,
          targetFat: finalCalculations.targetFat,
          adaptiveExpenditure: expenditureResult.estimatedExpenditure,
          expenditureStatus: expenditureResult.status,
          expenditureUpdatedAt: new Date(),
        },
      });
    }

    return {
      message: 'Ghi nhận cân nặng thành công',
      data: log,
    };
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

    return {
      message: 'Cập nhật bản ghi cân nặng thành công',
      data: updated,
    };
  }

  /**
   * Lấy lịch sử cân nặng theo thứ tự thời gian (dùng vẽ biểu đồ Line Chart)
   */
  async getLogs(userId: string, limit: number = 30) {
    const logs = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      take: limit,
    });

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
    const logs = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      take: limit,
    });

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

    // Lấy bản ghi cân nặng đầu tiên để xác định mốc bắt đầu
    const earliestLog = await this.prisma.weightLog.findFirst({
      where: { userId },
      orderBy: { date: 'asc' },
    });

    const startWeight = earliestLog ? earliestLog.weightKg : user.weightKg;
    const currentWeight = user.weightKg;
    const targetWeight = user.targetWeightKg;

    let progressPercent = 0;
    let weightChanged = 0;
    let remainingToGoal = 0;

    if (startWeight && currentWeight) {
      weightChanged = Math.round((currentWeight - startWeight) * 10) / 10;
    }

    if (currentWeight && targetWeight) {
      remainingToGoal = Math.round(Math.abs(currentWeight - targetWeight) * 10) / 10;

      if (startWeight && startWeight !== targetWeight) {
        const totalSpan = Math.abs(startWeight - targetWeight);
        const achievedSpan = Math.abs(currentWeight - startWeight);

        // Kiểm tra xem có đang đi đúng hướng không
        const isLosing = user.goal === 'LOSE_WEIGHT' && currentWeight <= startWeight;
        const isGaining = user.goal === 'GAIN_WEIGHT' && currentWeight >= startWeight;

        if (isLosing || isGaining) {
          progressPercent = Math.min(100, Math.round((achievedSpan / totalSpan) * 100));
        }
      }
    }

    return {
      message: 'Lấy tiến độ cân nặng thành công',
      data: {
        goal: user.goal,
        startWeightKg: startWeight,
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

    return {
      message: 'Xóa bản ghi cân nặng thành công',
    };
  }
}
