import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tổng hợp các chỉ số KPI vận hành của hệ thống
   */
  async getDashboardSummary() {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      activePremiums,
      pendingOrders,
      paidOrders,
      revenueResult,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.subscriptionState.count({
        where: {
          status: { in: ['ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD'] },
          expiryTime: { gt: now },
        },
      }),
      this.prisma.paymentOrder.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.paymentOrder.count({
        where: { status: 'PAID' },
      }),
      this.prisma.paymentOrder.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
      }),
    ]);

    const totalRevenueVnd = revenueResult._sum.amount || 0;

    return {
      message: 'Lấy dữ liệu tổng quan quản trị thành công',
      data: {
        users: {
          total: totalUsers,
          newLast7Days: newUsers7d,
          newLast30Days: newUsers30d,
        },
        subscriptions: {
          activePremiums,
        },
        orders: {
          pending: pendingOrders,
          paid: paidOrders,
          totalRevenueVnd,
        },
        timestamp: now,
      },
    };
  }
}
