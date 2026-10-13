import {
  Optional,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../../payments/payments.service';
import { AdminAuditService } from './admin-audit.service';
import { QueryOrdersDto } from '../dto/query-orders.dto';
import { AdminReauthService } from './admin-reauth.service';
import { DEFAULT_TIMEZONE, dayBoundsForKey } from '../../common/utils/date-zone.util';

@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AdminAuditService,
    @Optional() private readonly reauth?: AdminReauthService,
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
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: dayBoundsForKey(query.from, DEFAULT_TIMEZONE).start } : {}),
        ...(query.to ? { lt: dayBoundsForKey(query.to, DEFAULT_TIMEZONE).end } : {}),
      };
    }
    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
      where.amount = {
        ...(query.minAmount !== undefined ? { gte: query.minAmount } : {}),
        ...(query.maxAmount !== undefined ? { lte: query.maxAmount } : {}),
      };
    }
    const sortKey = ['createdAt', 'amount', 'expiresAt'].includes(query.sort ?? '') ? (query.sort as string) : 'createdAt';
    const sortOrder = query.order === 'asc' ? 'asc' : 'desc';

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
        orderBy: { [sortKey]: sortOrder },
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
    input?: { password?: string; note?: string },
  ) {
    // Tiền: backend kiểm tra lại mật khẩu admin; ẩn nút ở frontend không phải cơ chế bảo mật
    if (this.reauth) await this.reauth.verifyPassword(adminId, input?.password);
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
      reason: input?.note?.trim() || `Duyệt đơn nạp tiền chuyển khoản mã ${orderBefore.code}`,
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
    password?: string,
  ) {
    // Huỷ đơn khác "thanh toán thất bại": bắt buộc lý do và xác thực lại khi chạy qua API quản trị
    if (this.reauth) {
      reason = this.reauth.requireReason(reason);
      await this.reauth.verifyPassword(adminId, password);
    }
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

  /** Chi tiết một đơn: thông tin đơn, người dùng, cảnh báo duyệt muộn và lịch sử xử lý (từ nhật ký quản trị). */
  async getOrderDetail(orderId: string, now: Date = new Date()) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    const history = await this.prisma.adminAuditLog.findMany({
      where: { targetType: 'PaymentOrder', targetId: orderId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, adminEmail: true, reason: true, createdAt: true, before: true, after: true },
    });
    return {
      message: 'Lấy chi tiết đơn thành công',
      data: {
        ...order,
        // Quá hạn thanh toán nhưng vẫn còn duyệt được trong cửa sổ cho phép: admin phải đối chiếu kỹ sao kê
        pastDue: ['PENDING', 'EXPIRED'].includes(order.status) && order.expiresAt.getTime() < now.getTime(),
        history,
      },
    };
  }

  /** Ghi chú nội bộ cho đơn (đối soát). Không đổi trạng thái đơn. */
  async setOrderNote(adminId: string, adminEmail: string | undefined, orderId: string, note: string) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId }, select: { adminNote: true } });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    const clean = note.trim().slice(0, 500) || null;
    const updated = await this.prisma.paymentOrder.update({ where: { id: orderId }, data: { adminNote: clean } });
    await this.auditService.logAction({
      adminId, adminEmail, action: 'NOTE_PAYMENT', targetType: 'PaymentOrder', targetId: orderId,
      before: { adminNote: order.adminNote }, after: { adminNote: clean },
    });
    return { message: 'Đã lưu ghi chú', data: { id: updated.id, adminNote: updated.adminNote } };
  }
}
