import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryUsersDto } from '../dto/query-users.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Danh sách người dùng phân trang & tìm kiếm (Bảo mật quyền riêng tư BR-17.1)
   */
  async getUsers(query: QueryUsersDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (query.isPremium === 'true') {
      where.subscriptionState = {
        expiryTime: { gt: new Date() },
      };
    } else if (query.isPremium === 'false') {
      where.OR = [
        { subscriptionState: null },
        { subscriptionState: { expiryTime: { lte: new Date() } } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          subscriptionState: {
            select: {
              productId: true,
              status: true,
              expiryTime: true,
              autoRenewing: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      message: 'Lấy danh sách người dùng thành công',
      data: {
        items: users,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  /**
   * Xem lịch sử thanh toán và trạng thái gói cước của 1 người dùng
   */
  async getUserBilling(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        subscriptionState: true,
        purchases: {
          orderBy: { createdAt: 'desc' },
        },
        manualGrants: {
          orderBy: { startsAt: 'desc' },
        },
        paymentOrders: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const billingEvents = await this.prisma.billingEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      message: 'Lấy thông tin thanh toán người dùng thành công',
      data: {
        ...user,
        billingEvents,
      },
    };
  }
}
