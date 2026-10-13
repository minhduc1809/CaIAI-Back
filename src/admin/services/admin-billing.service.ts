import { cfg } from '../../system-config/config.holder';
import {
  Optional,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../../billing/billing.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminReauthService } from './admin-reauth.service';
import {
  AdminGrantPremiumDto,
  AdminRevokeGrantDto,
} from '../dto/admin-grant-premium.dto';

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly auditService: AdminAuditService,
    @Optional() private readonly reauth?: AdminReauthService,
  ) {}

  /**
   * Cấp ngày Premium thủ công cho người dùng (BR-17.3)
   */
  async grantPremium(
    adminId: string,
    adminEmail: string | undefined,
    dto: AdminGrantPremiumDto,
  ) {
    // Quyền Premium là quyền lợi có giá trị: backend kiểm tra lại mật khẩu admin
    if (this.reauth) await this.reauth.verifyPassword(adminId, dto.password);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    if (dto.days > cfg('admin.maxGrantDays')) {
      throw new BadRequestException(`Cấp thủ công tối đa ${cfg('admin.maxGrantDays')} ngày mỗi lần (admin.maxGrantDays)`);
    }

    const now = new Date();

    // Kiểm tra xem người dùng có grant nào đang còn hiệu lực không để cộng dồn
    const activeGrant = await this.prisma.manualGrant.findFirst({
      where: {
        userId: dto.userId,
        revokedAt: null,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
    });

    const baseTime =
      activeGrant && activeGrant.endsAt > now
        ? activeGrant.endsAt.getTime()
        : now.getTime();
    const endsAt = new Date(baseTime + dto.days * 24 * 60 * 60 * 1000);

    const grant = await this.prisma.manualGrant.create({
      data: {
        userId: dto.userId,
        adminId,
        reason: dto.reason,
        startsAt: now,
        endsAt,
      },
    });

    // Ghi BillingEvent để lưu vết lịch sử giao dịch
    await this.prisma.billingEvent.create({
      data: {
        userId: dto.userId,
        type: 'ADMIN_GRANT',
        actorId: adminId,
        payload: {
          grantId: grant.id,
          days: dto.days,
          reason: dto.reason,
          startsAt: now,
          endsAt,
        },
      },
    });

    // Huỷ cache entitlement
    this.billingService.invalidate(dto.userId);

    // Ghi Audit Log
    await this.auditService.logAction({
      adminId,
      adminEmail,
      action: 'GRANT_PREMIUM',
      targetType: 'User',
      targetId: dto.userId,
      after: { grantId: grant.id, days: dto.days, endsAt },
      reason: dto.reason,
    });

    return {
      message: `Cấp ${dto.days} ngày Premium thành công`,
      data: grant,
    };
  }

  /**
   * Thu hồi quyền Premium đã cấp tay (BR-17.3)
   */
  async revokeGrant(
    adminId: string,
    adminEmail: string | undefined,
    grantId: string,
    dto: AdminRevokeGrantDto,
  ) {
    if (this.reauth) await this.reauth.verifyPassword(adminId, dto.password);
    const grant = await this.prisma.manualGrant.findUnique({
      where: { id: grantId },
    });

    if (!grant) {
      throw new NotFoundException('Không tìm thấy quyền cấp thủ công');
    }

    if (grant.revokedAt) {
      throw new BadRequestException(
        'Quyền cấp thủ công này đã bị thu hồi trước đó',
      );
    }

    const now = new Date();
    const updated = await this.prisma.manualGrant.update({
      where: { id: grantId },
      data: {
        revokedAt: now,
        revokedBy: adminId,
      },
    });

    // Ghi BillingEvent
    await this.prisma.billingEvent.create({
      data: {
        userId: grant.userId,
        type: 'ADMIN_REVOKE',
        actorId: adminId,
        payload: {
          grantId,
          reason: dto.reason,
          revokedAt: now,
        },
      },
    });

    // Huỷ cache entitlement
    this.billingService.invalidate(grant.userId);

    // Ghi Audit Log
    await this.auditService.logAction({
      adminId,
      adminEmail,
      action: 'REVOKE_PREMIUM',
      targetType: 'ManualGrant',
      targetId: grantId,
      reason: dto.reason,
    });

    return {
      message: 'Thu hồi quyền Premium thành công',
      data: updated,
    };
  }

  /**
   * Danh sách quyền Premium cấp (cấp tay và từ đơn QR): lọc theo trạng thái, nguồn, tìm theo email người dùng.
   * Trạng thái: ACTIVE (còn hiệu lực), EXPIRED (hết hạn), REVOKED (đã thu hồi).
   */
  async listGrants(query: { status?: string; source?: string; search?: string; page?: number; limit?: number }, now: Date = new Date()) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = {};
    if (query.status === 'ACTIVE') Object.assign(where, { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } });
    if (query.status === 'EXPIRED') Object.assign(where, { revokedAt: null, endsAt: { lte: now } });
    if (query.status === 'REVOKED') Object.assign(where, { revokedAt: { not: null } });
    if (query.source === 'ADMIN' || query.source === 'QR_ORDER') where.source = query.source;
    if (query.search?.trim()) where.user = { email: { contains: query.search.trim(), mode: 'insensitive' } };
    const [total, rows] = await Promise.all([
      this.prisma.manualGrant.count({ where }),
      this.prisma.manualGrant.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
    ]);
    const adminIds = [...new Set(rows.map((r) => r.adminId).filter((x): x is string => !!x))];
    const admins = adminIds.length ? await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [];
    const adminEmail = new Map(admins.map((a) => [a.id, a.email]));
    const items = rows.map((r) => {
      const status = r.revokedAt ? 'REVOKED' : r.endsAt <= now ? 'EXPIRED' : 'ACTIVE';
      return {
        id: r.id,
        user: r.user,
        source: r.source,
        orderCode: r.orderCode,
        grantedBy: r.adminId ? adminEmail.get(r.adminId) ?? null : null,
        reason: r.reason,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        revokedAt: r.revokedAt,
        status,
        remainingDays: status === 'ACTIVE' ? Math.ceil((r.endsAt.getTime() - now.getTime()) / 86_400_000) : 0,
      };
    });
    return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
