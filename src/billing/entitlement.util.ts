import { PrismaClient, SubStatus } from '@prisma/client';
import { PLAN_LIMITS, PREMIUM_STATUSES } from './billing.constants';

type Db = Pick<PrismaClient, 'subscriptionState' | 'manualGrant'>;

export function isPremiumStatus(status: SubStatus, expiryTime: Date, now: Date): boolean {
  return PREMIUM_STATUSES.includes(status) && now < expiryTime;
}

/** BR-15.3: Premium nếu subscription còn hiệu lực HOẶC có ManualGrant còn hiệu lực. */
export async function isPremiumNow(db: Db, userId: string, now: Date = new Date()): Promise<boolean> {
  const sub = await db.subscriptionState.findUnique({ where: { userId } });
  if (sub && isPremiumStatus(sub.status, sub.expiryTime, now)) return true;
  const grant = await db.manualGrant.findFirst({
    where: { userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true },
  });
  return !!grant;
}

export async function getPlanLimits(db: Db, userId: string, now: Date = new Date()) {
  return (await isPremiumNow(db, userId, now)) ? PLAN_LIMITS.PREMIUM : PLAN_LIMITS.FREE;
}

/**
 * Người dùng này có đang bị áp giới hạn gói Free không? Chỉ khi BILLING_ENFORCE=true (giai đoạn phát triển/demo
 * mặc định tắt để kiểm thử đầy đủ mọi tính năng) VÀ người dùng không phải Premium.
 */
export async function isFreeTierLimited(db: Db, userId: string, now: Date = new Date()): Promise<boolean> {
  if (process.env.BILLING_ENFORCE !== 'true') return false;
  return !(await isPremiumNow(db, userId, now));
}
