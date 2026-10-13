import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_TIMEZONE, dayBoundsForKey } from '../../common/utils/date-zone.util';
import { resolveRange } from './admin-analytics.service';
import { toCsv } from '../csv.util';

const vnKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);

/**
 * Báo cáo doanh thu và đối soát (BR-17.2). Chỉ cộng đơn ĐÃ THANH TOÁN theo thời điểm thanh toán; đơn chờ, hết hạn hoặc huỷ
 * không bao giờ tính vào doanh thu thực nhận. Doanh thu Google Play chưa có số tiền trong dữ liệu hiện có nên không cộng
 * vào tổng, chỉ đếm số giao dịch.
 */
@Injectable()
export class AdminRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  private paidWhere(from: string, to: string) {
    return { status: 'PAID' as const, paidAt: { gte: dayBoundsForKey(from, DEFAULT_TIMEZONE).start, lt: dayBoundsForKey(to, DEFAULT_TIMEZONE).end } };
  }

  async summary(from?: string, to?: string, group: 'day' | 'month' = 'day', now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const startAt = dayBoundsForKey(range.from, DEFAULT_TIMEZONE).start;
    const endAt = dayBoundsForKey(range.to, DEFAULT_TIMEZONE).end;

    const [paid, expired, canceled, pending, googlePurchases] = await Promise.all([
      this.prisma.paymentOrder.findMany({ where: this.paidWhere(range.from, range.to), select: { id: true, userId: true, productId: true, amount: true, paidAt: true } }),
      this.prisma.paymentOrder.count({ where: { status: 'EXPIRED', createdAt: { gte: startAt, lt: endAt } } }),
      this.prisma.paymentOrder.count({ where: { status: 'CANCELED', createdAt: { gte: startAt, lt: endAt } } }),
      this.prisma.paymentOrder.count({ where: { status: 'PENDING', createdAt: { gte: startAt, lt: endAt } } }),
      this.prisma.purchase.count({ where: { purchaseTime: { gte: startAt, lt: endAt } } }),
    ]);

    const buckets = new Map<string, { period: string; revenueVnd: number; orders: number }>();
    for (const o of paid) {
      const k = group === 'month' ? vnKey(o.paidAt!).slice(0, 7) : vnKey(o.paidAt!);
      const b = buckets.get(k) ?? { period: k, revenueVnd: 0, orders: 0 };
      b.revenueVnd += o.amount;
      b.orders += 1;
      buckets.set(k, b);
    }
    const byProduct = new Map<string, { productId: string; orders: number; revenueVnd: number }>();
    for (const o of paid) {
      const p = byProduct.get(o.productId) ?? { productId: o.productId, orders: 0, revenueVnd: 0 };
      p.orders += 1;
      p.revenueVnd += o.amount;
      byProduct.set(o.productId, p);
    }

    // Premium mới / gia hạn: so với các đơn đã thanh toán hoặc quyền cấp trước đầu kỳ của cùng người dùng
    const payerIds = [...new Set(paid.map((p) => p.userId))];
    const earlier = payerIds.length
      ? await this.prisma.paymentOrder.findMany({ where: { userId: { in: payerIds }, status: 'PAID', paidAt: { lt: startAt } }, select: { userId: true }, distinct: ['userId'] })
      : [];
    const hadBefore = new Set(earlier.map((e) => e.userId));
    const firstTimers = new Set<string>();
    const renewers = new Set<string>();
    for (const id of payerIds) (hadBefore.has(id) ? renewers : firstTimers).add(id);

    // Rời bỏ: quyền hết hạn trong kỳ và không còn Premium nào hiệu lực vào cuối kỳ
    const ended = await this.prisma.manualGrant.findMany({ where: { revokedAt: null, endsAt: { gte: startAt, lt: endAt } }, select: { userId: true }, distinct: ['userId'] });
    const endedIds = ended.map((e) => e.userId);
    let churned = 0;
    if (endedIds.length) {
      const [stillGrant, stillSub] = await Promise.all([
        this.prisma.manualGrant.findMany({ where: { userId: { in: endedIds }, revokedAt: null, startsAt: { lt: endAt }, endsAt: { gte: endAt } }, select: { userId: true }, distinct: ['userId'] }),
        this.prisma.subscriptionState.findMany({ where: { userId: { in: endedIds }, expiryTime: { gte: endAt }, status: { in: ['ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD'] } }, select: { userId: true } }),
      ]);
      const still = new Set([...stillGrant.map((x) => x.userId), ...stillSub.map((x) => x.userId)]);
      churned = endedIds.filter((id) => !still.has(id)).length;
    }

    const total = paid.reduce((a, o) => a + o.amount, 0);
    return {
      range,
      group,
      totals: {
        revenueVnd: total,
        paidOrders: paid.length,
        averageOrderVnd: paid.length ? Math.round(total / paid.length) : null,
        expiredUnpaid: expired,
        canceled,
        pending,
        unpaidRatePct: paid.length + expired ? Math.round((expired / (paid.length + expired)) * 1000) / 10 : null,
      },
      premium: { newPayers: firstTimers.size, renewals: renewers.size, churned },
      series: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)),
      byProduct: [...byProduct.values()],
      googlePlay: { purchases: googlePurchases, note: 'Chưa có số tiền Google Play trong dữ liệu nên không cộng vào doanh thu.' },
    };
  }

  /** Bảng chi tiết các đơn đã thanh toán trong kỳ (theo thời điểm thanh toán). */
  async paidOrders(from?: string, to?: string, page = 1, limit = 20, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const where = this.paidWhere(range.from, range.to);
    const p = Math.max(1, page);
    const l = Math.min(100, Math.max(1, limit));
    const [total, items] = await Promise.all([
      this.prisma.paymentOrder.count({ where }),
      this.prisma.paymentOrder.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        select: { id: true, code: true, productId: true, amount: true, paidAt: true, approvedBy: true, user: { select: { email: true } } },
      }),
    ]);
    return { items, pagination: { total, page: p, limit: l, totalPages: Math.ceil(total / l) } };
  }

  /** CSV đối soát cho kế toán: chỉ các trường cần thiết, không có dữ liệu cá nhân ngoài email. */
  async exportCsv(from?: string, to?: string, now: Date = new Date()): Promise<string> {
    const range = resolveRange(from, to, now);
    const rows = await this.prisma.paymentOrder.findMany({
      where: this.paidWhere(range.from, range.to),
      orderBy: { paidAt: 'asc' },
      select: { code: true, productId: true, amount: true, paidAt: true, approvedBy: true, user: { select: { email: true } } },
    });
    return toCsv(
      ['Mã nội dung CK', 'Email', 'Gói', 'Số tiền (VND)', 'Thanh toán lúc', 'Duyệt bởi'],
      rows.map((r) => [r.code, r.user?.email ?? '', r.productId, r.amount, r.paidAt, r.approvedBy === 'AUTO:BANK' ? 'Tự động (ngân hàng)' : 'Admin']),
    );
  }
}
