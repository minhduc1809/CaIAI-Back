import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dayBoundsForKey, todayKey } from '../common/utils/date-zone.util';

const GLASS_ML = 250;
const ML_PER_KG = 35;
const MIN_GOAL_ML = 1500;
const MAX_GOAL_ML = 4000;
const DEFAULT_GOAL_ML = 2000;

@Injectable()
export class WaterLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** [00:00 hôm nay, 00:00 ngày mai) theo múi giờ của user (BR-07.2, BR-14). */
  private async todayBounds(userId: string): Promise<{ start: Date; end: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return dayBoundsForKey(todayKey(user?.timezone), user?.timezone);
  }

  /** Mục tiêu nước/ngày theo cân nặng thật của user (35ml/kg, làm tròn theo ly 250ml). */
  private async computeGoalMl(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { weightKg: true },
    });
    if (!user?.weightKg || user.weightKg <= 0) return DEFAULT_GOAL_ML;
    const raw = user.weightKg * ML_PER_KG;
    const rounded = Math.round(raw / GLASS_ML) * GLASS_ML;
    return Math.min(MAX_GOAL_ML, Math.max(MIN_GOAL_ML, rounded));
  }

  async getToday(userId: string) {
    const { start, end } = await this.todayBounds(userId);
    const [agg, goalMl] = await Promise.all([
      this.prisma.waterLog.aggregate({
        where: { userId, loggedAt: { gte: start, lt: end } },
        _sum: { amountMl: true },
      }),
      this.computeGoalMl(userId),
    ]);
    return {
      totalMl: agg._sum.amountMl ?? 0,
      goalMl,
      glassMl: GLASS_ML,
    };
  }

  async add(userId: string, amountMl?: number) {
    await this.prisma.waterLog.create({
      data: { userId, amountMl: amountMl ?? GLASS_ML },
    });
    return this.getToday(userId);
  }

  /** Hoàn tác lần uống gần nhất trong hôm nay. */
  async undoLast(userId: string) {
    const { start, end } = await this.todayBounds(userId);
    const last = await this.prisma.waterLog.findFirst({
      where: { userId, loggedAt: { gte: start, lt: end } },
      orderBy: { loggedAt: 'desc' },
    });
    if (last) {
      await this.prisma.waterLog.delete({ where: { id: last.id } });
    }
    return this.getToday(userId);
  }
}
