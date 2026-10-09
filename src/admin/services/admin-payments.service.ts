import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../../payments/payments.service';
import { AdminAuditService } from './admin-audit.service';
import { QueryOrdersDto } from '../dto/query-orders.dto';

@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AdminAuditService,
  ) {}

  /**
   * Danh sách đơn chuyển khoản VietQR phân trang & lọc
   */
  async getOrders(query: QueryOrdersDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.paymentOrder.count({ where }),
      this.prisma.paymentOrder.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      message: 'Lấy danh sách đơn thanh toán thành công',
      data: {
        items,
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
   * Duyệt đơn nạp tiền thủ công (BR-17.2)
   */
  async approveOrder(
    adminId: string,
    adminEmail: string | undefined,
    orderId: string,
  ) {
    const orderBefore = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });

    if (!orderBefore) {
      throw new NotFoundException('Không tìm thấy đơn hàng cần duyệt');
    }

    // Gọi logic settleOrder đã được bảo vệ transaction & cộng dồn hạn
    const result = await this.paymentsService.adminApprove(adminId, orderId);

    // Ghi Audit Log
    await this.auditService.logAction({
      adminId,
      adminEmail,
      action: 'APPROVE_PAYMENT',
      targetType: 'PaymentOrder',
      targetId: orderId,
      before: { status: orderBefore.status },
      after: { status: 'PAID' },
      reason: `Duyệt đơn nạp tiền chuyển khoản mã ${orderBefore.code}`,
    });

    return {
      message: 'Duyệt đơn thanh toán thành công',
      data: result,
    };
  }

  /**
   * Huỷ / Từ chối đơn nạp tiền
   */
  async rejectOrder(
    adminId: string,
    adminEmail: string | undefined,
    orderId: string,
    reason?: string,
  ) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    if (order.status === 'PAID') {
      throw new BadRequestException(
        'Không thể huỷ đơn hàng đã thanh toán thành công',
      );
    }

    const updated = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELED',
      },
    });

    // Ghi Audit Log
    await this.auditService.logAction({
      adminId,
      adminEmail,
      action: 'REJECT_PAYMENT',
      targetType: 'PaymentOrder',
      targetId: orderId,
      before: { status: order.status },
      after: { status: 'CANCELED' },
      reason: reason || 'Quản trị viên từ chối / huỷ đơn',
    });

    return {
      message: 'Huỷ đơn thanh toán thành công',
      data: updated,
    };
  }
}
