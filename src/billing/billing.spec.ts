import { SubStatus } from '@prisma/client';
import { BillingService, obfuscatedAccountIdFor } from './billing.service';
import {
  GooglePlayClient,
  InvalidPurchaseTokenError,
  PlaySubscription,
  parseSubscriptionV2,
} from './google-play.client';
import { isPremiumNow } from './entitlement.util';
import { PremiumGuard } from './premium.guard';

const DAY = 24 * 3600 * 1000;

/** Bộ nhớ giả cho các bảng billing; đủ cho các thao tác BillingService dùng. */
function makeDb() {
  const t = {
    purchase: new Map<string, any>(),
    sub: new Map<string, any>(),
    events: [] as any[],
    grants: [] as any[],
    users: new Map<string, any>([
      ['u1', { id: 'u1', timezone: 'Asia/Ho_Chi_Minh', programType: 'COACHED' }],
      ['u2', { id: 'u2', timezone: 'Asia/Ho_Chi_Minh', programType: 'COACHED' }],
    ]),
    checkIns: [{ userId: 'u1', status: 'PENDING' }] as any[],
  };
  const db: any = {
    _t: t,
    product: {
      findUnique: async ({ where }: any) =>
        ['premium_monthly', 'premium_yearly'].includes(where.productId)
          ? { productId: where.productId, isActive: true }
          : null,
    },
    purchase: {
      findUnique: async ({ where }: any) => t.purchase.get(where.purchaseToken) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = t.purchase.get(where.purchaseToken);
        t.purchase.set(where.purchaseToken, cur ? { ...cur, ...update } : { ...create });
      },
      update: async ({ where, data }: any) => {
        t.purchase.set(where.purchaseToken, { ...t.purchase.get(where.purchaseToken), ...data });
      },
    },
    subscriptionState: {
      findUnique: async ({ where }: any) => t.sub.get(where.userId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = t.sub.get(where.userId);
        t.sub.set(where.userId, cur ? { ...cur, ...update } : { ...create });
      },
      update: async ({ where, data }: any) => {
        t.sub.set(where.userId, { ...t.sub.get(where.userId), ...data });
      },
    },
    manualGrant: {
      findFirst: async ({ where }: any) =>
        t.grants.find(
          (g) =>
            g.userId === where.userId &&
            !g.revokedAt &&
            g.startsAt <= where.startsAt.lte &&
            g.endsAt > where.endsAt.gt,
        ) ?? null,
    },
    billingEvent: {
      findUnique: async ({ where }: any) => t.events.find((e) => e.messageId === where.messageId) ?? null,
      create: async ({ data }: any) => {
        if (data.messageId && t.events.some((e) => e.messageId === data.messageId)) {
          throw Object.assign(new Error('dup'), { code: 'P2002' });
        }
        t.events.push(data);
      },
    },
    user: {
      findUnique: async ({ where }: any) => t.users.get(where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const u = t.users.get(where.id);
        if (u && where.programType.in.includes(u.programType)) Object.assign(u, data);
        return { count: 1 };
      },
    },
    checkIn: {
      updateMany: async ({ where, data }: any) => {
        for (const c of t.checkIns) {
          if (c.userId === where.userId && where.status.in.includes(c.status)) Object.assign(c, data);
        }
        return { count: 1 };
      },
    },
    usageCounter: { findUnique: async () => null },
    $transaction: async (cb: any) => cb(db),
  };
  return db;
}

class FakeGoogle extends GooglePlayClient {
  subs = new Map<string, PlaySubscription>();
  acked: string[] = [];
  down = false;
  pushOk = true;
  async getSubscription(token: string) {
    if (this.down) throw Object.assign(new Error('down'), { status: 503 });
    const s = this.subs.get(token);
    if (!s) throw new InvalidPurchaseTokenError('bad');
    return { ...s };
  }
  async acknowledge(_p: string, token: string) {
    this.acked.push(token);
    const s = this.subs.get(token);
    if (s) s.acknowledged = true;
  }
  async verifyPushAuth() {
    if (!this.pushOk) throw new Error('unauthorized');
  }
}

function sub(userId: string, over: Partial<PlaySubscription> = {}): PlaySubscription {
  return {
    productId: 'premium_monthly',
    orderId: 'GPA.1',
    purchaseTime: new Date(),
    expiryTime: new Date(Date.now() + 30 * DAY),
    status: SubStatus.ACTIVE,
    autoRenewing: true,
    isTrial: false,
    acknowledged: false,
    obfuscatedAccountId: obfuscatedAccountIdFor(userId),
    raw: {},
    ...over,
  };
}

function rtdn(messageId: string, token: string, notificationType: number) {
  const data = Buffer.from(
    JSON.stringify({ subscriptionNotification: { notificationType, purchaseToken: token, subscriptionId: 'premium_monthly' } }),
  ).toString('base64');
  return { message: { messageId, data } };
}

describe('BR-16 Thanh toán Google Play', () => {
  let db: any;
  let google: FakeGoogle;
  let svc: BillingService;
  const notifications: any = { create: jest.fn(async () => ({})) };

  beforeEach(() => {
    db = makeDb();
    google = new FakeGoogle();
    notifications.create.mockClear();
    svc = new BillingService(db, google, notifications);
  });

  it('T1: mua tháng → ACTIVE, đã acknowledge, mở khoá Premium', async () => {
    google.subs.set('tok1', sub('u1'));
    const e: any = await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    expect(e.plan).toBe('PREMIUM');
    expect(e.status).toBe('ACTIVE');
    expect(e.limits.aiPhotoPerDay).toBe(30);
    expect(google.acked).toEqual(['tok1']);
    expect(db._t.purchase.get('tok1').acknowledged).toBe(true);
  });

  it('T2: verify hai lần cùng token không tạo bản ghi mới và không cộng quyền hai lần', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    const first = db._t.sub.get('u1').expiryTime;
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    expect(db._t.purchase.size).toBe(1);
    expect(db._t.sub.size).toBe(1);
    expect(db._t.sub.get('u1').expiryTime).toEqual(first);
    expect(google.acked).toHaveLength(1);
  });

  it('T3: token của tài khoản khác → 409, kể cả khi chưa có bản ghi Purchase', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    await expect(svc.verify('u2', { purchaseToken: 'tok1', productId: 'premium_monthly' })).rejects.toMatchObject({
      response: { code: 'PURCHASE_BELONGS_TO_OTHER_ACCOUNT' },
    });
    google.subs.set('tok2', sub('u1'));
    await expect(svc.verify('u2', { purchaseToken: 'tok2', productId: 'premium_monthly' })).rejects.toMatchObject({
      response: { code: 'PURCHASE_BELONGS_TO_OTHER_ACCOUNT' },
    });
    expect(await isPremiumNow(db, 'u2')).toBe(false);
  });

  it('T4: thanh toán PENDING → chưa mở khoá và chưa acknowledge', async () => {
    google.subs.set('tok1', sub('u1', { status: SubStatus.PENDING }));
    const e: any = await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    expect(e.plan).toBe('FREE');
    expect(e.status).toBe('PENDING');
    expect(google.acked).toHaveLength(0);
  });

  it('T5: tắt tự gia hạn → CANCELED nhưng vẫn là Premium đến hết hạn', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    google.subs.get('tok1')!.status = SubStatus.CANCELED;
    await svc.handleRtdn('Bearer x', rtdn('m1', 'tok1', 3));
    svc.invalidate('u1');
    const e: any = await svc.getEntitlement('u1');
    expect(e.status).toBe('CANCELED');
    expect(e.plan).toBe('PREMIUM');
  });

  it('T6: hết hạn → EXPIRED, về MANUAL giữ nguyên mục tiêu, Check-in chờ hết hiệu lực', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    google.subs.get('tok1')!.status = SubStatus.EXPIRED;
    google.subs.get('tok1')!.expiryTime = new Date(Date.now() - 1000);
    await svc.handleRtdn('Bearer x', rtdn('m2', 'tok1', 13));
    expect((await svc.getEntitlement('u1') as any).plan).toBe('FREE');
    expect(db._t.sub.get('u1').status).toBe('EXPIRED');
    expect(db._t.users.get('u1').programType).toBe('MANUAL');
    expect(db._t.checkIns[0].status).toBe('EXPIRED');
  });

  it('T7: hoàn tiền (RTDN REVOKED) → mất quyền ngay dù expiryTime còn xa', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    await svc.handleRtdn('Bearer x', rtdn('m3', 'tok1', 12));
    expect(db._t.sub.get('u1').status).toBe('REVOKED');
    expect(await isPremiumNow(db, 'u1')).toBe(false);
    expect(db._t.users.get('u1').programType).toBe('MANUAL');
  });

  it('T8: nâng cấp tháng → năm: token mới thay token cũ, không có khoảng trống quyền', async () => {
    google.subs.set('tokM', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tokM', productId: 'premium_monthly' });
    google.subs.set('tokY', sub('u1', {
      productId: 'premium_yearly',
      linkedPurchaseToken: 'tokM',
      expiryTime: new Date(Date.now() + 365 * DAY),
    }));
    google.subs.get('tokM')!.status = SubStatus.EXPIRED;
    await svc.verify('u1', { purchaseToken: 'tokY', productId: 'premium_yearly' });
    expect(db._t.sub.get('u1').currentPurchaseToken).toBe('tokY');
    expect(await isPremiumNow(db, 'u1')).toBe(true);
    // RTDN muộn của token cũ (đã EXPIRED) không được kéo quyền xuống
    await svc.handleRtdn('Bearer x', rtdn('m4', 'tokM', 13));
    expect(db._t.sub.get('u1').currentPurchaseToken).toBe('tokY');
    expect(await isPremiumNow(db, 'u1')).toBe(true);
  });

  it('T9: cài lại app → gửi lại token đã có thì quyền quay lại', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    db._t.sub.clear(); // mất trạng thái cục bộ
    const e: any = await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    expect(e.plan).toBe('PREMIUM');
  });

  it('T10: cùng một message RTDN gửi hai lần chỉ xử lý một lần', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    const spy = jest.spyOn(google, 'getSubscription');
    const body = rtdn('dup', 'tok1', 2);
    expect(await svc.handleRtdn('Bearer x', body)).toEqual({ processed: true });
    expect(await svc.handleRtdn('Bearer x', body)).toEqual({ duplicate: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Google lỗi → 503 và không cấp quyền; token giả → 400 có ghi BillingEvent', async () => {
    google.down = true;
    await expect(svc.verify('u1', { purchaseToken: 'x', productId: 'premium_monthly' })).rejects.toThrow('down');
    expect(await isPremiumNow(db, 'u1')).toBe(false);
    google.down = false;
    await expect(svc.verify('u1', { purchaseToken: 'fake', productId: 'premium_monthly' })).rejects.toMatchObject({
      response: { code: 'INVALID_PURCHASE_TOKEN' },
    });
    expect(db._t.events.some((e: any) => e.type === 'VERIFY_INVALID')).toBe(true);
  });

  it('productId không bán hoặc khác với giao dịch thật → bị từ chối', async () => {
    google.subs.set('tok1', sub('u1'));
    await expect(svc.verify('u1', { purchaseToken: 'tok1', productId: 'gold' })).rejects.toMatchObject({
      response: { code: 'UNKNOWN_PRODUCT' },
    });
    await expect(svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_yearly' })).rejects.toMatchObject({
      response: { code: 'INVALID_PURCHASE_TOKEN' },
    });
  });

  it('RTDN sai chữ ký Pub/Sub bị từ chối và không xử lý gì', async () => {
    google.pushOk = false;
    await expect(svc.handleRtdn(undefined, rtdn('m9', 'tok1', 2))).rejects.toThrow();
    expect(db._t.events).toHaveLength(0);
  });

  it('IN_GRACE_PERIOD vẫn Premium kèm banner và gửi thông báo BILLING_ISSUE', async () => {
    google.subs.set('tok1', sub('u1'));
    await svc.verify('u1', { purchaseToken: 'tok1', productId: 'premium_monthly' });
    google.subs.get('tok1')!.status = SubStatus.IN_GRACE_PERIOD;
    await svc.handleRtdn('Bearer x', rtdn('m5', 'tok1', 6));
    const e: any = await svc.getEntitlement('u1');
    expect(e.plan).toBe('PREMIUM');
    expect(e.banner).toBe('GRACE_PERIOD');
    expect(notifications.create).toHaveBeenCalledWith('u1', 'BILLING_ISSUE', expect.any(String), expect.any(String));
  });

  it('đối soát lười: quá hạn mà chưa có RTDN thì hỏi lại Google, tối đa 1 lần/giờ', async () => {
    google.subs.set('tok1', sub('u1', { expiryTime: new Date(Date.now() - 1000) }));
    db._t.sub.set('u1', {
      userId: 'u1', productId: 'premium_monthly', status: 'ACTIVE', expiryTime: new Date(Date.now() - 1000),
      autoRenewing: true, isTrial: false, currentPurchaseToken: 'tok1', lastReconciledAt: null,
    });
    db._t.purchase.set('tok1', { purchaseToken: 'tok1', userId: 'u1' });
    const spy = jest.spyOn(google, 'getSubscription');
    // Google báo đã gia hạn
    google.subs.get('tok1')!.expiryTime = new Date(Date.now() + 30 * DAY);
    const e: any = await svc.getEntitlement('u1');
    expect(e.plan).toBe('PREMIUM');
    expect(spy).toHaveBeenCalledTimes(1);
    svc.invalidate('u1');
    await svc.getEntitlement('u1');
    expect(spy).toHaveBeenCalledTimes(1); // hết hạn rồi nhưng đã đối soát trong vòng 1 giờ → không gọi lại
  });

  it('ManualGrant còn hiệu lực cũng là Premium; thu hồi thì mất', async () => {
    const now = Date.now();
    db._t.grants.push({ userId: 'u2', startsAt: new Date(now - DAY), endsAt: new Date(now + DAY), revokedAt: null });
    expect(await isPremiumNow(db, 'u2')).toBe(true);
    db._t.grants[0].revokedAt = new Date();
    expect(await isPremiumNow(db, 'u2')).toBe(false);
  });
});

describe('PremiumGuard', () => {
  const ctx = (userId?: string): any => ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined }) }),
  });
  const reflector: any = { getAllAndOverride: () => true };

  afterEach(() => delete process.env.BILLING_ENFORCE);

  it('mặc định chưa bật BILLING_ENFORCE thì không chặn', async () => {
    const guard = new PremiumGuard(reflector, makeDb());
    await expect(guard.canActivate(ctx('u1'))).resolves.toBe(true);
  });

  it('bật BILLING_ENFORCE: user Free nhận 402 PREMIUM_REQUIRED, user Premium đi qua', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const db = makeDb();
    const guard = new PremiumGuard(reflector, db);
    await expect(guard.canActivate(ctx('u1'))).rejects.toMatchObject({
      status: 402,
      response: { code: 'PREMIUM_REQUIRED' },
    });
    db._t.sub.set('u1', { status: 'ACTIVE', expiryTime: new Date(Date.now() + DAY) });
    await expect(guard.canActivate(ctx('u1'))).resolves.toBe(true);
  });
});

describe('parseSubscriptionV2', () => {
  it('đọc đúng trạng thái, hạn, tài khoản mờ và trạng thái acknowledge', () => {
    const r = parseSubscriptionV2({
      subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      latestOrderId: 'GPA.9',
      startTime: '2026-10-01T00:00:00Z',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      externalAccountIdentifiers: { obfuscatedExternalAccountId: 'abc' },
      linkedPurchaseToken: 'old',
      lineItems: [{ productId: 'premium_yearly', expiryTime: '2027-10-01T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
    });
    expect(r).toMatchObject({
      status: 'IN_GRACE_PERIOD',
      productId: 'premium_yearly',
      acknowledged: true,
      obfuscatedAccountId: 'abc',
      linkedPurchaseToken: 'old',
      autoRenewing: true,
    });
    expect(r.expiryTime.toISOString()).toBe('2027-10-01T00:00:00.000Z');
  });

  it('phản hồi thiếu dữ liệu bị coi là token không hợp lệ', () => {
    expect(() => parseSubscriptionV2({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' })).toThrow(InvalidPurchaseTokenError);
  });
});
