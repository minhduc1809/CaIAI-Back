import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, SubStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  GooglePlayClient,
  InvalidPurchaseTokenError,
  PlaySubscription,
} from './google-play.client';
import { isPremiumStatus, isPremiumNow } from './entitlement.util';
import {
  ENTITLEMENT_CACHE_MS,
  PLAN_LIMITS,
  RECONCILE_MIN_INTERVAL_MS,
  RECONCILE_STATUSES,
} from './billing.constants';
import { todayKey } from '../common/utils/date-zone.util';

/** Mã loại thông báo RTDN SUBSCRIPTION_REVOKED của Google Play. */
const RTDN_SUBSCRIPTION_REVOKED = 12;

export function obfuscatedAccountIdFor(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GooglePlayClient,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- entitlement

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  async getEntitlement(userId: string, now: Date = new Date()) {
    const hit = this.cache.get(userId);
    if (hit && now.getTime() - hit.at < ENTITLEMENT_CACHE_MS) return hit.value;

    await this.reconcileIfNeeded(userId, now);

    const [sub, premium, user] = await Promise.all([
      this.prisma.subscriptionState.findUnique({ where: { userId } }),
      isPremiumNow(this.prisma, userId, now),
      this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    ]);
    const counter = await this.prisma.usageCounter.findUnique({
      where: { userId_date: { userId, date: todayKey(user?.timezone, now) } },
    });

    // Premium cấp tay (QR hoặc admin) hiển thị hạn của lần cấp còn dài nhất
    const grant = await this.prisma.manualGrant.findFirst({
      where: { userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
    });
    const subActive = !!sub && isPremiumStatus(sub.status, sub.expiryTime, now);

    const banner =
      sub?.status === SubStatus.IN_GRACE_PERIOD
        ? 'GRACE_PERIOD'
        : sub?.status === SubStatus.ON_HOLD
          ? 'ON_HOLD'
          : null;

    const value = {
      plan: premium ? 'PREMIUM' : 'FREE',
      status: sub?.status ?? null,
      source: subActive ? 'GOOGLE_PLAY' : grant ? 'MANUAL' : null,
      expiryTime: subActive ? sub!.expiryTime : (grant?.endsAt ?? sub?.expiryTime ?? null),
      autoRenewing: subActive ? sub!.autoRenewing : false,
      isTrial: sub?.isTrial ?? false,
      productId: sub?.productId ?? null,
      banner,
      limits: premium ? PLAN_LIMITS.PREMIUM : PLAN_LIMITS.FREE,
      // true: các giới hạn gói (xem trước 30 ngày, lịch sử, khoá Premium) đang được áp dụng
      enforced: process.env.BILLING_ENFORCE === 'true',
      usageToday: {
        aiPhoto: counter?.aiPhoto ?? 0,
        menuScans: counter?.menuScans ?? 0,
        suggestMeals: counter?.suggestMeals ?? 0,
        barcodeLookups: counter?.barcodeLookups ?? 0,
        chatMessages: counter?.chatMessages ?? 0,
        chatTokens: counter?.chatTokens ?? 0,
      },
    };
    this.cache.set(userId, { at: now.getTime(), value });
    return value;
  }

  /** BR-16.6: quá expiryTime mà chưa có RTDN mới thì hỏi lại Google, tối đa 1 lần/giờ/user. */
  private async reconcileIfNeeded(userId: string, now: Date) {
    const sub = await this.prisma.subscriptionState.findUnique({ where: { userId } });
    if (!sub || sub.expiryTime > now || !RECONCILE_STATUSES.includes(sub.status)) return;
    if (
      sub.lastReconciledAt &&
      now.getTime() - sub.lastReconciledAt.getTime() < RECONCILE_MIN_INTERVAL_MS
    ) {
      return;
    }

    await this.prisma.subscriptionState.update({
      where: { userId },
      data: { lastReconciledAt: now },
    });
    try {
      const fresh = await this.google.getSubscription(sub.currentPurchaseToken);
      await this.applySubscription(userId, sub.currentPurchaseToken, fresh);
      await this.logEvent({
        type: 'RECONCILE',
        userId,
        purchaseToken: sub.currentPurchaseToken,
        payload: { status: fresh.status },
      });
    } catch (e) {
      this.logger.warn(`Đối soát thất bại cho ${userId}: ${(e as Error).message}`);
      // Không xác minh được: quyền vẫn tắt theo expiryTime; dọn hệ quả mất Premium (idempotent)
      await this.onPremiumLost(userId);
    }
    this.invalidate(userId);
  }

  // --------------------------------------------------------------------- verify

  async verify(userId: string, dto: { purchaseToken: string; productId: string }) {
    const product = await this.prisma.product.findUnique({ where: { productId: dto.productId } });
    if (!product?.isActive) throw new BadRequestException({ code: 'UNKNOWN_PRODUCT' });

    const existing = await this.prisma.purchase.findUnique({
      where: { purchaseToken: dto.purchaseToken },
    });
    if (existing?.userId && existing.userId !== userId) {
      throw new ConflictException({ code: 'PURCHASE_BELONGS_TO_OTHER_ACCOUNT' });
    }

    let sub: PlaySubscription;
    try {
      sub = await this.google.getSubscription(dto.purchaseToken);
    } catch (e) {
      if (e instanceof InvalidPurchaseTokenError) {
        await this.logEvent({
          type: 'VERIFY_INVALID',
          userId,
          purchaseToken: dto.purchaseToken,
          payload: { productId: dto.productId },
        });
        throw new BadRequestException({ code: 'INVALID_PURCHASE_TOKEN' });
      }
      throw e; // 503: không cấp quyền khi chưa xác minh được
    }
    if (sub.productId !== dto.productId) {
      await this.logEvent({
        type: 'VERIFY_INVALID',
        userId,
        purchaseToken: dto.purchaseToken,
        payload: { claimed: dto.productId, actual: sub.productId },
      });
      throw new BadRequestException({ code: 'INVALID_PURCHASE_TOKEN' });
    }
    if (sub.obfuscatedAccountId !== obfuscatedAccountIdFor(userId)) {
      await this.logEvent({
        type: 'VERIFY_MISMATCH',
        userId,
        purchaseToken: dto.purchaseToken,
        payload: {},
      });
      throw new ConflictException({ code: 'PURCHASE_BELONGS_TO_OTHER_ACCOUNT' });
    }

    await this.applySubscription(userId, dto.purchaseToken, sub, 'VERIFY');
    return this.getEntitlement(userId);
  }

  // ----------------------------------------------------------------------- RTDN

  async handleRtdn(authorization: string | undefined, body: any) {
    await this.google.verifyPushAuth(authorization);

    const messageId: string | undefined = body?.message?.messageId;
    if (!messageId) throw new BadRequestException();
    if (await this.prisma.billingEvent.findUnique({ where: { messageId } })) {
      return { duplicate: true };
    }

    let data: any;
    try {
      data = JSON.parse(Buffer.from(body.message.data ?? '', 'base64').toString('utf-8'));
    } catch {
      throw new BadRequestException();
    }

    const n = data?.subscriptionNotification;
    if (!n?.purchaseToken) {
      await this.logEvent({ type: 'RTDN_OTHER', messageId, payload: data ?? {} });
      return { ignored: true };
    }

    const purchase = await this.prisma.purchase.findUnique({
      where: { purchaseToken: n.purchaseToken },
    });
    if (purchase?.userId) {
      // Gọi lại Google để lấy trạng thái mới nhất, không tin nội dung message (BR-16.6)
      const fresh = await this.google.getSubscription(n.purchaseToken);
      if (n.notificationType === RTDN_SUBSCRIPTION_REVOKED) fresh.status = SubStatus.REVOKED;
      await this.applySubscription(purchase.userId, n.purchaseToken, fresh);
    }
    await this.logEvent({
      type: `RTDN_${n.notificationType}`,
      messageId,
      userId: purchase?.userId ?? undefined,
      purchaseToken: n.purchaseToken,
      payload: data,
    });
    return { processed: true };
  }

  // ------------------------------------------------------------------ nội bộ

  /**
   * Ghi Purchase + SubscriptionState trong một transaction (idempotent theo purchaseToken).
   * Token cũ không được ghi đè token mới hơn trừ khi là nâng cấp (linkedPurchaseToken).
   */
  private async applySubscription(
    userId: string,
    token: string,
    sub: PlaySubscription,
    eventType?: string,
  ) {
    const now = new Date();
    const before = await this.prisma.subscriptionState.findUnique({ where: { userId } });
    const wasPremium = !!before && isPremiumStatus(before.status, before.expiryTime, now);

    const isCurrentToken = !before || before.currentPurchaseToken === token;
    const isUpgrade = !!before && sub.linkedPurchaseToken === before.currentPurchaseToken;
    const newIsPremium = isPremiumStatus(sub.status, sub.expiryTime, now);
    const takesOver = isCurrentToken || isUpgrade || (newIsPremium && !wasPremium);

    await this.prisma.$transaction(async (tx) => {
      await tx.purchase.upsert({
        where: { purchaseToken: token },
        create: {
          purchaseToken: token,
          orderId: sub.orderId,
          userId,
          productId: sub.productId,
          purchaseTime: sub.purchaseTime,
          acknowledged: sub.acknowledged,
          linkedPurchaseToken: sub.linkedPurchaseToken,
          rawResponse: sub.raw as Prisma.InputJsonValue,
        },
        update: {
          orderId: sub.orderId,
          acknowledged: sub.acknowledged,
          rawResponse: sub.raw as Prisma.InputJsonValue,
        },
      });
      if (takesOver) {
        const data = {
          productId: sub.productId,
          status: sub.status,
          expiryTime: sub.expiryTime,
          autoRenewing: sub.autoRenewing,
          isTrial: sub.isTrial,
          currentPurchaseToken: token,
        };
        await tx.subscriptionState.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        });
      }
      if (eventType) {
        await tx.billingEvent.create({
          data: {
            type: eventType,
            userId,
            purchaseToken: token,
            payload: { status: sub.status, productId: sub.productId },
          },
        });
      }
    });

    if (takesOver) {
      if (sub.status !== SubStatus.PENDING && !sub.acknowledged) {
        try {
          await this.google.acknowledge(sub.productId, token);
          await this.prisma.purchase.update({
            where: { purchaseToken: token },
            data: { acknowledged: true },
          });
        } catch (e) {
          // Sẽ thử lại ở lần verify/đối soát sau; Google hoàn tiền nếu quá 3 ngày không acknowledge
          this.logger.error(`Acknowledge thất bại cho ${userId}: ${(e as Error).message}`);
        }
      }
      if (wasPremium && !newIsPremium) await this.onPremiumLost(userId);
      if (
        before?.status !== sub.status &&
        (sub.status === SubStatus.IN_GRACE_PERIOD || sub.status === SubStatus.ON_HOLD)
      ) {
        await this.notifications
          .create(
            userId,
            'BILLING_ISSUE',
            'Thanh toán gói Premium gặp vấn đề',
            'Google Play chưa thu được tiền gia hạn. Hãy cập nhật phương thức thanh toán để giữ quyền Premium.',
          )
          .catch(() => undefined);
      }
    }
    this.invalidate(userId);
  }

  /** BR-15.4: về MANUAL (giữ nguyên mục tiêu), Check-in đang chờ hết hiệu lực. Idempotent. */
  async onPremiumLost(userId: string) {
    if (await isPremiumNow(this.prisma, userId)) return; // còn ManualGrant
    await this.prisma.user.updateMany({
      where: { id: userId, programType: { in: ['COACHED', 'COLLABORATIVE'] } },
      data: { programType: 'MANUAL' },
    });
    await this.prisma.checkIn.updateMany({
      where: { userId, status: { in: ['PENDING', 'SNOOZED'] } },
      data: { status: 'EXPIRED' },
    });
  }

  private async logEvent(e: {
    type: string;
    userId?: string;
    purchaseToken?: string;
    messageId?: string;
    payload: unknown;
  }) {
    try {
      await this.prisma.billingEvent.create({
        data: {
          type: e.type,
          userId: e.userId,
          purchaseToken: e.purchaseToken,
          messageId: e.messageId,
          payload: e.payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }
}
