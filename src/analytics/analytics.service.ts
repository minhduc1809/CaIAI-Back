import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { InsightDto } from './dto/insight.dto';

const PLATEAU_WEEKLY_RATIO = 0.0025; // 0.25% body weight / tuần
const GOAL_DEVIATION_RATIO = 0.5; // 50%

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weightLogsService: WeightLogsService,
  ) {}

  /**
   * Insight tự động (BRD 4.11.3): Plateau Detection (C022) + Goal Deviation (C023).
   * Chỉ mang tính thông tin, không tự động thay đổi target của người dùng.
   */
  async getInsights(
    userId: string,
  ): Promise<{ message: string; data: { insights: InsightDto[] } }> {
    const insights: InsightDto[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { weightKg: true, weightRateKgPerWeek: true, goal: true },
    });

    const trendResult = await this.weightLogsService.getWeightTrend(userId, 60);
    const trendData = trendResult.data as {
      date: string;
      trendWeight: number;
    }[];

    const weeklyTrend = this.groupByWeek(trendData);
    const weeklyRates: number[] = [];
    for (let i = 1; i < weeklyTrend.length; i++) {
      weeklyRates.push(weeklyTrend[i] - weeklyTrend[i - 1]);
    }

    const bodyWeight = user?.weightKg ?? 0;

    // Plateau Detection: 3 tuần liên tiếp gần nhất |rate| < 0.25% body weight
    if (bodyWeight > 0 && weeklyRates.length >= 3) {
      const lastThree = weeklyRates.slice(-3);
      const threshold = PLATEAU_WEEKLY_RATIO * bodyWeight;
      const isPlateau = lastThree.every((rate) => Math.abs(rate) < threshold);
      if (isPlateau) {
        insights.push({
          type: 'PLATEAU',
          message:
            'Cân nặng gần như không đổi trong 3 tuần qua dù bạn vẫn theo dõi calo — có thể đã đến lúc điều chỉnh mục tiêu.',
        });
      }
    }

    // Goal Deviation: 2 tuần liên tiếp gần nhất lệch >50% so với tốc độ mục tiêu (bỏ qua goal MAINTAIN)
    if (user?.goal && user.goal !== 'MAINTAIN' && weeklyRates.length >= 2) {
      const targetMagnitude = user.weightRateKgPerWeek ?? 0.5;
      const expectedRate =
        user.goal === 'LOSE_WEIGHT' ? -targetMagnitude : targetMagnitude;

      if (Math.abs(expectedRate) > 0.0001) {
        const lastTwo = weeklyRates.slice(-2);
        const isDeviating = lastTwo.every(
          (rate) =>
            Math.abs(rate - expectedRate) / Math.abs(expectedRate) >
            GOAL_DEVIATION_RATIO,
        );
        if (isDeviating) {
          insights.push({
            type: 'GOAL_DEVIATION',
            message:
              'Tốc độ thay đổi cân nặng đang lệch nhiều so với mục tiêu — cân nhắc Check-in sớm hơn dự kiến.',
          });
        }
      }
    }

    return {
      message: 'Lấy insight tự động thành công',
      data: { insights },
    };
  }

  /**
   * Gộp trend weight theo tuần (bucket 7-ngày kể từ epoch), lấy giá trị cuối mỗi tuần.
   */
  private groupByWeek(
    trendData: { date: string; trendWeight: number }[],
  ): number[] {
    const weekMap = new Map<number, number>();
    for (const point of trendData) {
      const weekKey = Math.floor(
        new Date(point.date).getTime() / (7 * 24 * 60 * 60 * 1000),
      );
      weekMap.set(weekKey, point.trendWeight);
    }
    return [...weekMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value);
  }
}
