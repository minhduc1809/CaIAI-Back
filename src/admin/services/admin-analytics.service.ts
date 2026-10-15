import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { addDaysToKey, dateToKey, dayBoundsForKey, DEFAULT_TIMEZONE, keyToDate, todayKey } from '../../common/utils/date-zone.util';

/** Khoảng thời gian tối đa của một truy vấn phân tích, để không quét quá nhiều dữ liệu. */
export const MAX_RANGE_DAYS = 120;
const EXPIRING_SOON_MIN = 15;

export interface DateRange { from: string; to: string; days: number }

/** Chuẩn hoá khoảng [from, to] theo ngày (giờ Việt Nam). Mặc định 30 ngày gần nhất tính đến hôm nay. */
export function resolveRange(from?: string, to?: string, now: Date = new Date()): DateRange {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !re.test(from)) || (to && !re.test(to))) throw new BadRequestException('Ngày phải có dạng YYYY-MM-DD');
  const end = to ?? todayKey(DEFAULT_TIMEZONE, now);
  const start = from ?? addDaysToKey(end, -29);
  const days = Math.round((keyToDate(end).getTime() - keyToDate(start).getTime()) / 86_400_000) + 1;
  if (days < 1) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  if (days > MAX_RANGE_DAYS) throw new BadRequestException(`Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày`);
  return { from: start, to: end, days };
}

/** Khoảng liền trước có cùng độ dài, để so sánh theo kỳ. */
export function previousRange(r: DateRange): DateRange {
  const to = addDaysToKey(r.from, -1);
  return { from: addDaysToKey(to, -(r.days - 1)), to, days: r.days };
}

const startOf = (key: string) => dayBoundsForKey(key, DEFAULT_TIMEZONE).start;
const endOfExclusive = (key: string) => dayBoundsForKey(key, DEFAULT_TIMEZONE).end;

/**
 * Số liệu tổng hợp cho Dashboard (BR-17.4). Chỉ số ẩn danh, không có dữ liệu sức khỏe của từng người. Mọi con số lấy từ truy
 * vấn thật; chỉ số chưa tính được trả null thay vì suy diễn.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async pendingWork(now: Date = new Date()) {
    const soon = new Date(now.getTime() + EXPIRING_SOON_MIN * 60_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const [pendingOrders, expiringOrders, pendingSubmissions, dataRequests, dataRequestsOverdue, billingIssues] = await Promise.all([
      this.prisma.paymentOrder.count({ where: { status: 'PENDING' } }),
      this.prisma.paymentOrder.count({ where: { status: 'PENDING', expiresAt: { gt: now, lte: soon } } }),
      this.prisma.foodSubmission.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.dataRequest.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] } } }),
      this.prisma.dataRequest.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] }, dueAt: { lt: now } } }),
      this.prisma.subscriptionState.count({ where: { status: { in: ['IN_GRACE_PERIOD', 'ON_HOLD'] }, updatedAt: { gte: weekAgo } } }),
    ]);
    return { pendingOrders, expiringOrders, pendingSubmissions, dataRequests, dataRequestsOverdue, billingIssues };
  }

  private async activeUserCount(r: DateRange): Promise<number> {
    const rows = await this.prisma.meal.groupBy({
      by: ['userId'],
      where: { logDate: { gte: keyToDate(r.from), lte: keyToDate(r.to) } },
    });
    return rows.length;
  }

  private async revenueOf(r: DateRange) {
    const agg = await this.prisma.paymentOrder.aggregate({
      where: { status: 'PAID', paidAt: { gte: startOf(r.from), lt: endOfExclusive(r.to) } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return { amount: agg._sum.amount ?? 0, orders: agg._count._all };
  }

  async overview(from?: string, to?: string, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const prev = previousRange(range);
    const [total, totalPrev, newCur, newPrev, activeCur, activePrev, revCur, revPrev, pending, expiring] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({ where: { role: 'USER', createdAt: { lt: startOf(range.from) } } }),
      this.prisma.user.count({ where: { role: 'USER', createdAt: { gte: startOf(range.from), lt: endOfExclusive(range.to) } } }),
      this.prisma.user.count({ where: { role: 'USER', createdAt: { gte: startOf(prev.from), lt: endOfExclusive(prev.to) } } }),
      this.activeUserCount(range),
      this.activeUserCount(prev),
      this.revenueOf(range),
      this.revenueOf(prev),
      this.prisma.paymentOrder.count({ where: { status: 'PENDING' } }),
      this.prisma.paymentOrder.count({ where: { status: 'PENDING', expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_SOON_MIN * 60_000) } } }),
    ]);

    // Premium đang hiệu lực: gộp theo người dùng để một người có nhiều nguồn chỉ được đếm một lần
    const [subs, grants] = await Promise.all([
      this.prisma.subscriptionState.findMany({
        where: { status: { in: ['ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD'] }, expiryTime: { gt: now } },
        select: { userId: true },
      }),
      this.prisma.manualGrant.findMany({
        where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
        select: { userId: true, source: true },
      }),
    ]);
    const all = new Set<string>([...subs.map((s) => s.userId), ...grants.map((g) => g.userId)]);

    return {
      range,
      updatedAt: now.toISOString(),
      users: {
        total,
        totalPrevious: totalPrev,
        newInRange: { current: newCur, previous: newPrev },
        // Hoạt động = có ghi ít nhất một bữa trong kỳ (số tổng hợp ẩn danh)
        active: { current: activeCur, previous: activePrev },
      },
      premium: {
        active: all.size,
        byManual: grants.filter((g) => g.source !== 'QR_ORDER').length,
        byQr: grants.filter((g) => g.source === 'QR_ORDER').length,
        byGooglePlay: subs.length,
      },
      revenue: {
        received: { current: revCur.amount, previous: revPrev.amount },
        ordersPaid: { current: revCur.orders, previous: revPrev.orders },
      },
      orders: { pending, expiringSoon: expiring },
    };
  }

  /** Chuỗi theo ngày (giờ Việt Nam): người dùng mới, người dùng hoạt động, doanh thu thực nhận, số đơn đã thanh toán. */
  async timeseries(from?: string, to?: string, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const keys: string[] = [];
    for (let i = 0; i < range.days; i++) keys.push(addDaysToKey(range.from, i));
    const bucket = new Map(keys.map((k) => [k, { date: k, newUsers: 0, activeUsers: 0, revenueVnd: 0, paidOrders: 0 }]));

    const [users, meals, orders] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'USER', createdAt: { gte: startOf(range.from), lt: endOfExclusive(range.to) } }, select: { createdAt: true } }),
      this.prisma.meal.groupBy({ by: ['logDate', 'userId'], where: { logDate: { gte: keyToDate(range.from), lte: keyToDate(range.to) } } }),
      this.prisma.paymentOrder.findMany({ where: { status: 'PAID', paidAt: { gte: startOf(range.from), lt: endOfExclusive(range.to) } }, select: { paidAt: true, amount: true } }),
    ]);
    const vnKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);
    for (const u of users) {
      const b = bucket.get(vnKey(u.createdAt));
      if (b) b.newUsers += 1;
    }
    for (const m of meals) {
      const b = bucket.get(dateToKey(m.logDate));
      if (b) b.activeUsers += 1; // mỗi (ngày, người dùng) chỉ một dòng nhờ groupBy
    }
    for (const o of orders) {
      const b = o.paidAt ? bucket.get(vnKey(o.paidAt)) : undefined;
      if (b) {
        b.revenueVnd += o.amount;
        b.paidOrders += 1;
      }
    }
    return { days: keys.map((k) => bucket.get(k)!) };
  }

  /**
   * Phễu chuyển đổi theo cohort: người dùng đăng ký trong khoảng đã chọn VÀ đã đủ 7 ngày kể từ lúc đăng ký (để bước "quay
   * lại sau 7 ngày" có mẫu số đúng). Mọi bước dùng cùng một nhóm người, tỷ lệ chỉ chia trong nhóm đó.
   */
  async funnel(from?: string, to?: string, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const matureBefore = new Date(now.getTime() - 7 * 86_400_000);
    const cohort = await this.prisma.user.findMany({
      where: { role: 'USER', createdAt: { gte: startOf(range.from), lt: endOfExclusive(range.to), lte: matureBefore } },
      select: { id: true, createdAt: true, targetCalories: true },
    });
    const ids = cohort.map((c) => c.id);
    const created = new Map(cohort.map((c) => [c.id, c.createdAt]));

    const [firstMeal, lateMeals, paid, subs, grants] = ids.length === 0 ? [[], [], [], [], []] : await Promise.all([
      this.prisma.meal.groupBy({ by: ['userId'], where: { userId: { in: ids } } }),
      this.prisma.meal.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { logDate: true } }),
      this.prisma.paymentOrder.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'PAID' } }),
      this.prisma.subscriptionState.findMany({ where: { userId: { in: ids } }, select: { userId: true } }),
      this.prisma.manualGrant.findMany({ where: { userId: { in: ids }, source: 'ADMIN' }, select: { userId: true } }),
    ]);

    const onboarded = cohort.filter((c) => c.targetCalories !== null).length;
    const withMeal = new Set((firstMeal as { userId: string }[]).map((r) => r.userId));
    // Quay lại: có bữa ăn được ghi vào ngày thứ 7 trở đi kể từ ngày đăng ký
    const returned = (lateMeals as { userId: string; _max: { logDate: Date | null } }[]).filter((r) => {
      const c = created.get(r.userId);
      return c && r._max.logDate && r._max.logDate.getTime() >= keyToDate(addDaysToKey(dateToKey(c), 7)).getTime();
    }).length;
    const bought = new Set<string>([
      ...(paid as { userId: string }[]).map((p) => p.userId),
      ...(subs as { userId: string }[]).map((s) => s.userId),
      ...(grants as { userId: string }[]).map((g) => g.userId),
    ]).size;

    const counts: [string, string, number][] = [
      ['registered', 'Đăng ký', cohort.length],
      ['onboarded', 'Hoàn tất onboarding', onboarded],
      ['firstMeal', 'Ghi bữa đầu tiên', withMeal.size],
      ['returned7', 'Quay lại từ ngày thứ 7', returned],
      ['premium', 'Có Premium', bought],
    ];
    const start = counts[0][2];
    return {
      cohort: { from: range.from, to: range.to },
      definition:
        'Nhóm người dùng đăng ký trong khoảng đã chọn và đã đủ 7 ngày. "Hoàn tất onboarding" = đã có mục tiêu calo; "Quay lại" = có bữa ăn ghi từ ngày thứ 7 trở đi; "Có Premium" = từng có đơn QR đã thanh toán, gói Google Play hoặc quyền do admin cấp. Mọi tỷ lệ chia trong cùng nhóm.',
      steps: counts.map(([key, label, count], i) => ({
        key,
        label,
        count,
        fromPrevPct: i === 0 ? null : counts[i - 1][2] ? Math.round((count / counts[i - 1][2]) * 1000) / 10 : null,
        fromStartPct: i === 0 ? null : start ? Math.round((count / start) * 1000) / 10 : null,
      })),
    };
  }

  /**
   * Giữ chân D1/D7/D30: trong nhóm đăng ký trong khoảng (và đã đủ N ngày), tỷ lệ người có ghi bữa ăn đúng vào ngày thứ N
   * kể từ ngày đăng ký.
   */
  async retention(from?: string, to?: string, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const users = await this.prisma.user.findMany({
      where: { role: 'USER', createdAt: { gte: startOf(range.from), lt: endOfExclusive(range.to) } },
      select: { id: true, createdAt: true },
      take: 20_000,
    });
    const vnKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);
    const signup = new Map(users.map((u) => [u.id, vnKey(u.createdAt)]));
    const meals = users.length === 0 ? [] : await this.prisma.meal.groupBy({ by: ['userId', 'logDate'], where: { userId: { in: users.map((u) => u.id) } } });
    const active = new Map<string, Set<string>>();
    for (const m of meals) {
      const set = active.get(m.userId) ?? new Set<string>();
      set.add(dateToKey(m.logDate));
      active.set(m.userId, set);
    }
    const today = todayKey(DEFAULT_TIMEZONE, now);
    const rows = ([['D1', 1], ['D7', 7], ['D30', 30]] as const).map(([key, n]) => {
      // Chỉ tính người đã đủ N ngày: ngày thứ N của họ phải đã kết thúc
      const eligible = users.filter((u) => addDaysToKey(signup.get(u.id)!, n) < today);
      const retained = eligible.filter((u) => active.get(u.id)?.has(addDaysToKey(signup.get(u.id)!, n))).length;
      return {
        key,
        label: `${key} (ghi bữa vào ngày thứ ${n})`,
        eligible: eligible.length,
        retained,
        ratePct: eligible.length ? Math.round((retained / eligible.length) * 1000) / 10 : null,
      };
    });
    return {
      definition: 'Nhóm đăng ký trong khoảng đã chọn. Giữ chân DN = có ghi bữa ăn đúng vào ngày thứ N sau ngày đăng ký; chỉ tính người đã qua đủ N ngày.',
      rows,
    };
  }
}
