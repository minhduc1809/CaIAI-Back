import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminReauthService } from './admin-reauth.service';
import { DEFAULT_TIMEZONE, dayBoundsForKey, todayKey } from '../../common/utils/date-zone.util';
import type { AdminActor } from './admin-foods.service';

const SORTABLE = new Set(['createdAt', 'email', 'name']);

/**
 * Quản lý người dùng cho admin (BR-17.1). Chỉ thông tin tài khoản, gói, giao dịch và số đếm hạn mức. Tuyệt đối không có
 * dữ liệu sức khỏe: bữa ăn, cân nặng, chat, ảnh, hồ sơ cơ thể.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AdminAuditService,
    @Optional() private readonly reauth?: AdminReauthService,
  ) {}

  /** Điều kiện lọc theo gói: Premium = có đăng ký còn hạn hoặc quyền cấp còn hiệu lực. */
  private planWhere(plan: string, now: Date) {
    const premium = {
      OR: [
        { subscriptionState: { is: { status: { in: ['ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD'] as any }, expiryTime: { gt: now } } } },
        { manualGrants: { some: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } } },
      ],
    };
    if (plan === 'PREMIUM') return premium;
    if (plan === 'FREE') return { NOT: premium };
    if (plan === 'GRACE') return { subscriptionState: { is: { status: { in: ['IN_GRACE_PERIOD', 'ON_HOLD'] as any } } } };
    if (plan === 'TRIAL') return { subscriptionState: { is: { isTrial: true, expiryTime: { gt: now } } } };
    return {};
  }

  /** Danh sách người dùng phân trang, lọc và sắp xếp phía máy chủ. */
  async getUsers(query: QueryUsersDto, now: Date = new Date()) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;
    const and: any[] = [];

    if (query.role) and.push({ role: query.role });
    if (query.search) {
      const term = query.search.trim();
      and.push({ OR: [{ email: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }, { username: { contains: term, mode: 'insensitive' } }] });
    }
    if (query.plan) and.push(this.planWhere(query.plan, now));
    else if (query.isPremium === 'true') and.push(this.planWhere('PREMIUM', now));
    else if (query.isPremium === 'false') and.push(this.planWhere('FREE', now));
    if (query.status === 'ACTIVE') and.push({ isActive: true });
    if (query.status === 'LOCKED') and.push({ isActive: false });
    if (query.emailVerified === 'true') and.push({ isEmailVerified: true });
    if (query.emailVerified === 'false') and.push({ isEmailVerified: false });
    if (query.from) and.push({ createdAt: { gte: dayBoundsForKey(query.from, DEFAULT_TIMEZONE).start } });
    if (query.to) and.push({ createdAt: { lt: dayBoundsForKey(query.to, DEFAULT_TIMEZONE).end } });
    const where = and.length ? { AND: and } : {};

    const sort = query.sort && SORTABLE.has(query.sort) ? query.sort : 'createdAt';
    const order = query.order === 'asc' ? 'asc' : 'desc';

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          authProvider: true,
          createdAt: true,
          subscriptionState: { select: { productId: true, status: true, expiryTime: true, autoRenewing: true, isTrial: true } },
          manualGrants: {
            where: { revokedAt: null, endsAt: { gt: now } },
            select: { endsAt: true, source: true },
            orderBy: { endsAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
    ]);

    return {
      message: 'Lấy danh sách người dùng thành công',
      data: {
        items: users,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  /**
   * Chi tiết một người dùng: tài khoản, gói, hạn mức hôm nay (số đếm), phiên đăng nhập (siêu dữ liệu, không có token).
   * Giao dịch lấy ở `getUserBilling`.
   */
  async getUserDetail(userId: string, now: Date = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, username: true, name: true, role: true, isActive: true, isEmailVerified: true, emailVerifiedAt: true,
        authProvider: true, createdAt: true, timezone: true, privacyAcceptedVersion: true, privacyAcceptedAt: true,
        subscriptionState: { select: { productId: true, status: true, expiryTime: true, autoRenewing: true, isTrial: true } },
        manualGrants: {
          where: { revokedAt: null, endsAt: { gt: now } },
          select: { id: true, source: true, startsAt: true, endsAt: true, reason: true },
          orderBy: { endsAt: 'desc' },
        },
        refreshSessions: {
          where: { revokedAt: null },
          select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
          orderBy: { lastUsedAt: 'desc' },
        },
      },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const usage = await this.prisma.usageCounter.findUnique({
      where: { userId_date: { userId, date: todayKey(user.timezone || DEFAULT_TIMEZONE, now) } },
      select: { aiPhoto: true, chatMessages: true, chatTokens: true, menuScans: true, suggestMeals: true, barcodeLookups: true },
    });
    const sub = user.subscriptionState;
    const subActive = !!sub && ['ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD'].includes(sub.status) && sub.expiryTime > now;
    const plan = subActive || user.manualGrants.length > 0 ? 'PREMIUM' : 'FREE';
    return {
      message: 'Lấy chi tiết người dùng thành công',
      data: { ...user, plan, usageToday: usage ?? { aiPhoto: 0, chatMessages: 0, chatTokens: 0, menuScans: 0, suggestMeals: 0, barcodeLookups: 0 } },
    };
  }

  private async target(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, isActive: true } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (user.role === 'ADMIN') throw new BadRequestException('Không thể thao tác lên tài khoản quản trị bằng chức năng này');
    return user;
  }

  /** Khoá tài khoản: không đăng nhập được và mọi phiên đang có bị thu hồi. Bắt buộc lý do và mật khẩu của admin. */
  async lock(actor: AdminActor, userId: string, input: { reason?: string; password?: string }) {
    const user = await this.target(userId);
    const reason = this.reauth!.requireReason(input.reason);
    await this.reauth!.verifyPassword(actor.id, input.password);
    if (!user.isActive) throw new ConflictException('Tài khoản đã bị khoá trước đó');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive: false, refreshTokenHash: null } }),
      this.prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit?.logAction({ adminId: actor.id, adminEmail: actor.email, action: 'LOCK_USER', targetType: 'User', targetId: userId, before: { isActive: true }, after: { isActive: false }, reason });
    return { message: 'Đã khoá tài khoản', data: { id: userId, isActive: false } };
  }

  async unlock(actor: AdminActor, userId: string, input: { reason?: string; password?: string }) {
    const user = await this.target(userId);
    const reason = this.reauth!.requireReason(input.reason);
    await this.reauth!.verifyPassword(actor.id, input.password);
    if (user.isActive) throw new ConflictException('Tài khoản đang hoạt động');
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    await this.audit?.logAction({ adminId: actor.id, adminEmail: actor.email, action: 'UNLOCK_USER', targetType: 'User', targetId: userId, before: { isActive: false }, after: { isActive: true }, reason });
    return { message: 'Đã mở khoá tài khoản', data: { id: userId, isActive: true } };
  }

  /** Buộc đăng xuất mọi thiết bị của người dùng (không khoá tài khoản). */
  async revokeSessions(actor: AdminActor, userId: string, input: { reason?: string; password?: string }) {
    await this.target(userId);
    const reason = this.reauth!.requireReason(input.reason);
    await this.reauth!.verifyPassword(actor.id, input.password);
    const res = await this.prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
    await this.audit?.logAction({ adminId: actor.id, adminEmail: actor.email, action: 'REVOKE_USER_SESSIONS', targetType: 'User', targetId: userId, after: { revoked: res.count }, reason });
    return { message: `Đã đăng xuất ${res.count} thiết bị`, data: { revoked: res.count } };
  }

  /** Xem lịch sử thanh toán và trạng thái gói cước của 1 người dùng. */
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
        // Không trả purchaseToken và rawResponse (dữ liệu thô của Google) cho giao diện quản trị
        purchases: { select: { id: true, orderId: true, productId: true, purchaseTime: true, acknowledged: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        manualGrants: { orderBy: { startsAt: 'desc' } },
        paymentOrders: { orderBy: { createdAt: 'desc' } },
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
