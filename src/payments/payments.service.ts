import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { PaymentOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';

const DAY = 24 * 3600 * 1000;
export const ORDER_TTL_MS = 30 * 60 * 1000;
/** Đơn hết hạn vẫn cho admin duyệt trong 7 ngày, vì khách có thể chuyển tiền muộn. */
export const LATE_APPROVAL_WINDOW_MS = 7 * DAY;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I, O, 0, 1 cho dễ đọc

/** Giá bán qua QR. Gói đăng ký Google Play lấy giá từ Play Console, không dùng bảng này. */
export const QR_PLANS = [
  { productId: 'premium_monthly', name: 'Premium tháng', amount: 59000, days: 30 },
  { productId: 'premium_yearly', name: 'Premium năm', amount: 449000, days: 365 },
] as const;

export function generateOrderCode(): string {
  let s = 'NW';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /** Thông tin ngân hàng lấy từ cấu hình máy chủ, không nằm trong code hay app. */
  private bank() {
    const bin = process.env.BANK_BIN;
    const accountNo = process.env.BANK_ACCOUNT_NO;
    const accountName = process.env.BANK_ACCOUNT_NAME;
    if (!bin || !accountNo || !accountName) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_NOT_CONFIGURED',
        message: 'Chưa cấu hình tài khoản nhận tiền.',
      });
    }
    return { bin, accountNo, accountName, bankName: process.env.BANK_NAME ?? '' };
  }

  qrUrl(order: { amount: number; code: string }) {
    const b = this.bank();
    const q = new URLSearchParams({
      amount: String(order.amount),
      addInfo: order.code,
      accountName: b.accountName,
    });
    return `https://img.vietqr.io/image/${b.bin}-${b.accountNo}-compact2.png?${q.toString()}`;
  }

  private view(o: {
    id: string;
    code: string;
    productId: string;
    amount: number;
    status: PaymentOrderStatus;
    expiresAt: Date;
    paidAt: Date | null;
  }) {
    const b = this.bank();
    return {
      id: o.id,
      code: o.code,
      productId: o.productId,
      amount: o.amount,
      status: o.status,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      transferContent: o.code,
      bankName: b.bankName,
      accountNo: b.accountNo,
      accountName: b.accountName,
      qrUrl: this.qrUrl(o),
    };
  }

  plans() {
    return QR_PLANS.map((p) => ({ ...p }));
  }

  async createOrder(userId: string, productId: string, now: Date = new Date()) {
    const plan = QR_PLANS.find((p) => p.productId === productId);
    if (!plan) throw new BadRequestException({ code: 'UNKNOWN_PRODUCT' });
    this.bank(); // báo lỗi cấu hình sớm

    // Đơn chờ đã quá hạn thì đóng lại; đơn còn hạn cùng gói thì dùng lại để khách không bị nhiều mã
    await this.prisma.paymentOrder.updateMany({
      where: { userId, status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    const existing = await this.prisma.paymentOrder.findFirst({
      where: { userId, productId, status: 'PENDING', expiresAt: { gte: now } },
    });
    if (existing) return this.view(existing);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.paymentOrder.create({
          data: {
            code: generateOrderCode(),
            userId,
            productId,
            amount: plan.amount,
            expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
          },
        });
        return this.view(created);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e; // trùng mã thì sinh mã khác
      }
    }
    throw new ServiceUnavailableException();
  }

  async getOrder(userId: string, orderId: string, now: Date = new Date()) {
    let order = await this.prisma.paymentOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException();
    if (order.status === 'PENDING' && order.expiresAt < now) {
      order = await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'EXPIRED' },
      });
    }
    return this.view(order);
  }

  async cancelOrder(userId: string, orderId: string) {
    await this.prisma.paymentOrder.updateMany({
      where: { id: orderId, userId, status: 'PENDING' },
      data: { status: 'CANCELED' },
    });
    return this.getOrder(userId, orderId);
  }

  async adminListOrders(now: Date = new Date()) {
    const orders = await this.prisma.paymentOrder.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { status: 'EXPIRED', createdAt: { gte: new Date(now.getTime() - LATE_APPROVAL_WINDOW_MS) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, username: true, email: true, name: true } } },
    });
    return orders.map((o) => ({
      id: o.id,
      code: o.code,
      productId: o.productId,
      amount: o.amount,
      status: o.status,
      createdAt: o.createdAt,
      expiresAt: o.expiresAt,
      user: o.user,
    }));
  }

  /** Admin xác nhận tay (dự phòng khi webhook ngân hàng không chạy). Idempotent. */
  async adminApprove(adminId: string, orderId: string, now: Date = new Date()) {
    return this.settleOrder(orderId, adminId, now, false);
  }

  /**
   * Chuyển đơn sang PAID và cấp Premium trong một transaction. Chỉ một lời gọi thắng bước chuyển
   * trạng thái nên gọi lặp (admin bấm hai lần, ngân hàng gửi lại webhook) không cộng hạn hai lần.
   * `allowCanceled`: tiền đã thật sự vào nên webhook vẫn cấp quyền cho đơn khách lỡ huỷ.
   */
  private async settleOrder(orderId: string, approvedBy: string, now: Date, allowCanceled: boolean) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException();
    if (order.status === 'PAID') return { alreadyPaid: true, orderId, code: order.code };
    if (order.status === 'CANCELED' && !allowCanceled) {
      throw new ConflictException({ code: 'ORDER_CANCELED' });
    }
    // Tính theo thời gian chứ không theo trạng thái: đơn PENDING quá hạn chưa kịp đổi sang EXPIRED vẫn bị chặn
    if (now.getTime() - order.expiresAt.getTime() > LATE_APPROVAL_WINDOW_MS) {
      throw new ConflictException({ code: 'ORDER_TOO_OLD' });
    }
    const plan = QR_PLANS.find((p) => p.productId === order.productId);
    if (!plan) throw new BadRequestException({ code: 'UNKNOWN_PRODUCT' });

    const won = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentOrder.updateMany({
        where: {
          id: orderId,
          status: { in: allowCanceled ? ['PENDING', 'EXPIRED', 'CANCELED'] : ['PENDING', 'EXPIRED'] },
        },
        data: { status: 'PAID', paidAt: now, approvedBy },
      });
      if (claimed.count === 0) return false;

      // Cộng dồn nếu người dùng đang còn Premium cấp tay
      const current = await tx.manualGrant.findFirst({
        where: { userId: order.userId, revokedAt: null, endsAt: { gt: now } },
        orderBy: { endsAt: 'desc' },
      });
      const base = current ? current.endsAt : now;
      await tx.manualGrant.create({
        data: {
          userId: order.userId,
          adminId: approvedBy,
          reason: `QR_ORDER:${order.code}`,
          startsAt: now,
          endsAt: new Date(base.getTime() + plan.days * DAY),
        },
      });
      return true;
    });

    this.billing.invalidate(order.userId);
    return { alreadyPaid: !won, orderId, code: order.code };
  }

  // ------------------------------------------------------------ webhook ngân hàng

  private checkWebhookKey(authorization?: string) {
    const expected = process.env.SEPAY_API_KEY;
    if (!expected) {
      throw new ServiceUnavailableException({ code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED' });
    }
    const given = (authorization ?? '').replace(/^(Apikey|Bearer)\s+/i, '').trim();
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
  }

  /**
   * Nhận biến động số dư từ SePay. Chỉ tin khi đúng khoá; chỉ xử lý tiền VÀO; mỗi giao dịch ngân hàng
   * chỉ xử lý một lần; chỉ cấp quyền khi tìm thấy mã đơn trong nội dung và số tiền đủ.
   * Trả success cho các trường hợp đã ghi nhận để SePay không gửi lại vô hạn.
   */
  async handleBankWebhook(authorization: string | undefined, body: any, now: Date = new Date()) {
    this.checkWebhookKey(authorization);

    const txId = body?.id != null ? `bank:${body.id}` : undefined;
    if (!txId) throw new BadRequestException();
    if (String(body?.transferType ?? '').toLowerCase() !== 'in') {
      return { success: true, ignored: 'NOT_INCOMING' };
    }
    if (await this.prisma.billingEvent.findUnique({ where: { messageId: txId } })) {
      return { success: true, duplicate: true };
    }

    const text = `${body?.code ?? ''} ${body?.content ?? ''} ${body?.description ?? ''}`.toUpperCase();
    const code = text.match(/NW[A-HJ-NP-Z2-9]{8}/)?.[0];
    const amount = Number(body?.transferAmount ?? 0);
    const log = (type: string, userId?: string) =>
      this.prisma.billingEvent.create({
        data: { type, userId, messageId: txId, payload: { code, amount, ref: body?.referenceCode ?? null } },
      });

    const order = code ? await this.prisma.paymentOrder.findUnique({ where: { code } }) : null;
    if (!order) {
      await log('PAYMENT_UNMATCHED');
      return { success: true, matched: false };
    }
    if (amount < order.amount) {
      await log('PAYMENT_UNDERPAID', order.userId); // thiếu tiền: không cấp, chờ người xử lý
      this.logger.warn(`Đơn ${order.code} chuyển thiếu: ${amount}/${order.amount}`);
      return { success: true, matched: true, granted: false };
    }
    try {
      await this.settleOrder(order.id, 'AUTO:BANK', now, true);
      await log('PAYMENT_AUTO_APPROVED', order.userId);
      return { success: true, matched: true, granted: true };
    } catch (e) {
      if (e instanceof ConflictException) {
        await log('PAYMENT_REJECTED', order.userId);
        return { success: true, matched: true, granted: false };
      }
      throw e; // lỗi tạm: chưa ghi event nên SePay gửi lại sẽ được xử lý
    }
  }
}
