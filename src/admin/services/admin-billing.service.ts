import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../../billing/billing.service';
import { AdminAuditService } from './admin-audit.service';
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
  ) {}

  /**
   * Cấp ngày Premium thủ công cho người dùng (BR-17.3)
   */
  async grantPremium(
    adminId: string,
    adminEmail: string | undefined,
    dto: AdminGrantPremiumDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
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
}
