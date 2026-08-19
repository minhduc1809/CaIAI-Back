import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { CreateWeightLogDto } from './dto/create-weight-log.dto';

@Injectable()
export class WeightLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthCalculator: HealthCalculatorService,
  ) {}

  /**
   * Ghi nhận cân nặng mới và tự động cập nhật lại Profile + BMI của User
   */
  async createLog(userId: string, dto: CreateWeightLogDto) {
    const { weightKg, note } = dto;

    // 1. Tạo bản ghi WeightLog
    const log = await this.prisma.weightLog.create({
      data: {
        userId,
        weightKg,
        note: note || null,
      },
    });

    // 2. Lấy thông tin user hiện tại để tính lại BMI/BMR/TDEE với cân nặng mới
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      const calculations = this.healthCalculator.calculateAllMetrics({
        heightCm: user.heightCm,
        weightKg,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        activityLevel: user.activityLevel,
        goal: user.goal,
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          weightKg,
          bmi: calculations.bmi,
          bmr: calculations.bmr,
          tdee: calculations.tdee,
          targetCalories: calculations.targetCalories,
          targetProtein: calculations.targetProtein,
          targetCarb: calculations.targetCarb,
          targetFat: calculations.targetFat,
        },
      });
    }

    return {
      message: 'Ghi nhận cân nặng thành công',
      data: log,
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
