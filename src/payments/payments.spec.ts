import { PaymentsService, generateOrderCode, ORDER_TTL_MS } from './payments.service';
import { isPremiumNow } from '../billing/entitlement.util';

const DAY = 24 * 3600 * 1000;

function makeDb() {
  const orders: any[] = [];
  const grants: any[] = [];
  let seq = 0;
  const match = (o: any, w: any) =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(o[k]);
        if ('lt' in v) return o[k] < v.lt;
        if ('gte' in v) return o[k] >= v.gte;
        return true;
      }
      return o[k] === v;
    });
  const db: any = {
    _orders: orders,
    _grants: grants,
    paymentOrder: {
      create: async ({ data }: any) => {
        if (orders.some((o) => o.code === data.code)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const o = { id: `o${++seq}`, status: 'PENDING', paidAt: null, approvedBy: null, createdAt: new Date(), ...data };
        orders.push(o);
        return o;
      },
      findFirst: async ({ where }: any) => orders.find((o) => match(o, where)) ?? null,
      findUnique: async ({ where }: any) =>
        orders.find((o) => (where.id ? o.id === where.id : o.code === where.code)) ?? null,
      update: async ({ where, data }: any) => Object.assign(orders.find((o) => o.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const hit = orders.filter((o) => match(o, where));
        hit.forEach((o) => Object.assign(o, data));
        return { count: hit.length };
      },
      findMany: async () => orders.map((o) => ({ ...o, user: { id: o.userId } })),
    },
    manualGrant: {
      findFirst: async ({ where }: any) =>
        grants
          .filter((g) => g.userId === where.userId && !g.revokedAt && g.endsAt > where.endsAt.gt)
          .sort((a, b) => b.endsAt - a.endsAt)[0] ?? null,
      create: async ({ data }: any) => {
        grants.push({ ...data });
      },
    },
    billingEvent: {
      _rows: [] as any[],
      findUnique: async ({ where }: any) => db.billingEvent._rows.find((e: any) => e.messageId === where.messageId) ?? null,
      create: async ({ data }: any) => {
        db.billingEvent._rows.push(data);
      },
    },
    subscriptionState: { findUnique: async () => null },
    $transaction: async (cb: any) => cb(db),
  };
  return db;
}

describe('Thanh toán QR ngân hàng', () => {
  let db: any;
  let billing: any;
  let svc: PaymentsService;
  const T0 = new Date('2026-10-07T03:00:00Z');

  beforeEach(() => {
    process.env.BANK_BIN = '970422';
    process.env.BANK_ACCOUNT_NO = '123456789';
    process.env.BANK_ACCOUNT_NAME = 'TEST USER';
    process.env.BANK_NAME = 'MB Bank';
    db = makeDb();
    billing = { invalidate: jest.fn() };
    svc = new PaymentsService(db, billing);
  });
  afterEach(() => {
    for (const k of ['BANK_BIN', 'BANK_ACCOUNT_NO', 'BANK_ACCOUNT_NAME', 'BANK_NAME']) delete process.env[k];
  });

  it('mã đơn có tiền tố NW, 10 ký tự, không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 50; i++) expect(generateOrderCode()).toMatch(/^NW[A-HJ-NP-Z2-9]{8}$/);
  });

  it('tạo đơn: đúng giá, QR chứa số tiền, nội dung và tài khoản; giá do server quyết định', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    expect(o.amount).toBe(59000);
    expect(o.status).toBe('PENDING');
    expect(o.qrUrl).toContain('970422-123456789');
    expect(o.qrUrl).toContain('amount=59000');
    expect(o.qrUrl).toContain(`addInfo=${o.code}`);
    expect(o.expiresAt.getTime() - T0.getTime()).toBe(ORDER_TTL_MS);
    expect((await svc.createOrder('u1', 'premium_yearly', T0) as any).amount).toBe(449000);
    await expect(svc.createOrder('u1', 'free_forever', T0)).rejects.toMatchObject({ response: { code: 'UNKNOWN_PRODUCT' } });
  });

  it('thiếu cấu hình ngân hàng → 503, không tạo đơn', async () => {
    delete process.env.BANK_ACCOUNT_NO;
    await expect(svc.createOrder('u1', 'premium_monthly', T0)).rejects.toMatchObject({
      response: { code: 'PAYMENT_NOT_CONFIGURED' },
    });
    expect(db._orders).toHaveLength(0);
  });

  it('bấm mua lại khi đơn còn hạn thì dùng lại đúng mã đó; hết hạn thì tạo đơn mới', async () => {
    const a: any = await svc.createOrder('u1', 'premium_monthly', T0);
    const b: any = await svc.createOrder('u1', 'premium_monthly', new Date(T0.getTime() + 60_000));
    expect(b.code).toBe(a.code);
    const c: any = await svc.createOrder('u1', 'premium_monthly', new Date(T0.getTime() + ORDER_TTL_MS + 1000));
    expect(c.code).not.toBe(a.code);
    expect(db._orders.find((o: any) => o.code === a.code).status).toBe('EXPIRED');
  });

  it('người dùng khác không xem hay huỷ được đơn của bạn', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    await expect(svc.getOrder('u2', o.id, T0)).rejects.toThrow();
    await svc.cancelOrder('u2', o.id).catch(() => undefined);
    expect(db._orders[0].status).toBe('PENDING');
  });

  it('duyệt đơn: cấp Premium đúng 30 ngày, báo xoá cache entitlement', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    expect(await isPremiumNow(db, 'u1', T0)).toBe(false);
    await svc.adminApprove('admin1', o.id, T0);
    expect(db._orders[0].status).toBe('PAID');
    expect(db._orders[0].approvedBy).toBe('admin1');
    expect(db._grants).toHaveLength(1);
    expect(db._grants[0].reason).toBe(`QR_ORDER:${o.code}`);
    expect(db._grants[0].endsAt.getTime() - T0.getTime()).toBe(30 * DAY);
    expect(billing.invalidate).toHaveBeenCalledWith('u1');
    expect(await svc.getOrder('u1', o.id, T0)).toMatchObject({ status: 'PAID' });
  });

  it('duyệt hai lần không cộng hạn hai lần', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    await svc.adminApprove('admin1', o.id, T0);
    const again: any = await svc.adminApprove('admin1', o.id, T0);
    expect(again.alreadyPaid).toBe(true);
    expect(db._grants).toHaveLength(1);
  });

  it('hai admin duyệt đồng thời: chỉ một lần cấp', async () => {
    const o: any = await svc.createOrder('u1', 'premium_yearly', T0);
    await Promise.all([svc.adminApprove('a1', o.id, T0), svc.adminApprove('a2', o.id, T0)]);
    expect(db._grants).toHaveLength(1);
    expect(db._grants[0].endsAt.getTime() - T0.getTime()).toBe(365 * DAY);
  });

  it('mua tiếp khi còn Premium thì cộng dồn từ ngày hết hạn hiện tại', async () => {
    const a: any = await svc.createOrder('u1', 'premium_monthly', T0);
    await svc.adminApprove('admin1', a.id, T0);
    const later = new Date(T0.getTime() + 10 * DAY);
    const b: any = await svc.createOrder('u1', 'premium_monthly', later);
    await svc.adminApprove('admin1', b.id, later);
    expect(db._grants[1].endsAt.getTime()).toBe(T0.getTime() + 60 * DAY);
  });

  it('khách chuyển muộn: đơn hết hạn vẫn duyệt được trong 7 ngày, sau đó thì không', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    const day2 = new Date(T0.getTime() + 2 * DAY);
    await svc.getOrder('u1', o.id, day2); // chuyển sang EXPIRED
    expect(db._orders[0].status).toBe('EXPIRED');
    await svc.adminApprove('admin1', o.id, day2);
    expect(db._orders[0].status).toBe('PAID');

    const o2: any = await svc.createOrder('u1', 'premium_yearly', day2);
    const day20 = new Date(day2.getTime() + 20 * DAY);
    await svc.getOrder('u1', o2.id, day20);
    await expect(svc.adminApprove('admin1', o2.id, day20)).rejects.toMatchObject({ response: { code: 'ORDER_TOO_OLD' } });
  });

  it('đơn đã huỷ không duyệt được', async () => {
    const o: any = await svc.createOrder('u1', 'premium_monthly', T0);
    await svc.cancelOrder('u1', o.id);
    await expect(svc.adminApprove('admin1', o.id, T0)).rejects.toMatchObject({ response: { code: 'ORDER_CANCELED' } });
    expect(db._grants).toHaveLength(0);
  });
});

describe('Webhook ngân hàng (SePay) tự duyệt', () => {
  let db: any;
  let svc: PaymentsService;
  const T0 = new Date('2026-10-07T03:00:00Z');
  const KEY = 'secret-key';
  const hook = (over: any = {}) => ({
    id: 1001,
    transferType: 'in',
    transferAmount: 59000,
    content: 'NWTEST',
    referenceCode: 'FT1',
    ...over,
  });

  beforeEach(() => {
    process.env.BANK_BIN = '970422';
    process.env.BANK_ACCOUNT_NO = '123';
    process.env.BANK_ACCOUNT_NAME = 'TEST';
    process.env.SEPAY_API_KEY = KEY;
    db = makeDb();
    svc = new PaymentsService(db, { invalidate: jest.fn() } as any);
  });
  afterEach(() => {
    for (const k of ['BANK_BIN', 'BANK_ACCOUNT_NO', 'BANK_ACCOUNT_NAME', 'SEPAY_API_KEY']) delete process.env[k];
  });

  async function newOrder(productId = 'premium_monthly') {
    return (await svc.createOrder('u1', productId, T0)) as any;
  }

  it('tiền vào đủ và đúng mã → tự cấp Premium, không cần admin', async () => {
    const o = await newOrder();
    const r: any = await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: `CK ${o.code} thanh toan` }), T0);
    expect(r).toMatchObject({ success: true, granted: true });
    expect(db._orders[0]).toMatchObject({ status: 'PAID', approvedBy: 'AUTO:BANK' });
    expect(await isPremiumNow(db, 'u1', T0)).toBe(true);
  });

  it('ngân hàng làm thường chữ hoặc dính ký tự khác vẫn nhận ra mã đơn', async () => {
    const o = await newOrder();
    await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: `mbvcb.123.${o.code.toLowerCase()}.chuyen tien` }), T0);
    expect(db._orders[0].status).toBe('PAID');
  });

  it('sai khoá hoặc thiếu khoá → bị từ chối, không cấp gì', async () => {
    const o = await newOrder();
    await expect(svc.handleBankWebhook('Apikey wrong', hook({ content: o.code }), T0)).rejects.toThrow();
    await expect(svc.handleBankWebhook(undefined, hook({ content: o.code }), T0)).rejects.toThrow();
    expect(db._orders[0].status).toBe('PENDING');
    delete process.env.SEPAY_API_KEY;
    await expect(svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: o.code }), T0)).rejects.toThrow();
  });

  it('SePay gửi lại cùng giao dịch chỉ cấp một lần', async () => {
    const o = await newOrder();
    const body = hook({ content: o.code });
    await svc.handleBankWebhook(`Apikey ${KEY}`, body, T0);
    const again: any = await svc.handleBankWebhook(`Apikey ${KEY}`, body, T0);
    expect(again.duplicate).toBe(true);
    expect(db._grants).toHaveLength(1);
  });

  it('hai giao dịch khác nhau cùng mã đơn (chuyển hai lần) cũng chỉ cấp một lần', async () => {
    const o = await newOrder();
    await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ id: 1, content: o.code }), T0);
    await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ id: 2, content: o.code }), T0);
    expect(db._grants).toHaveLength(1);
  });

  it('chuyển thiếu tiền → không cấp và ghi lại để xử lý', async () => {
    const o = await newOrder();
    const r: any = await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: o.code, transferAmount: 50000 }), T0);
    expect(r.granted).toBe(false);
    expect(db._orders[0].status).toBe('PENDING');
    expect(db.billingEvent._rows.some((e: any) => e.type === 'PAYMENT_UNDERPAID')).toBe(true);
  });

  it('chuyển dư tiền vẫn cấp đúng gói đã mua', async () => {
    const o = await newOrder();
    await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: o.code, transferAmount: 100000 }), T0);
    expect(db._grants[0].endsAt.getTime() - T0.getTime()).toBe(30 * DAY);
  });

  it('tiền ra, không có mã, hoặc mã lạ → bỏ qua nhưng vẫn trả success', async () => {
    await newOrder();
    expect(await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ id: 5, transferType: 'out', content: 'NWABCDEFGH' }), T0)).toMatchObject({ ignored: 'NOT_INCOMING' });
    expect(await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ id: 6, content: 'tien an sang' }), T0)).toMatchObject({ success: true, matched: false });
    expect(await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ id: 7, content: 'NWAAAAAAAA' }), T0)).toMatchObject({ matched: false });
    expect(db._grants).toHaveLength(0);
  });

  it('khách lỡ huỷ đơn rồi mới chuyển tiền → vẫn được cấp vì tiền đã vào', async () => {
    const o = await newOrder();
    await svc.cancelOrder('u1', o.id);
    await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: o.code }), T0);
    expect(db._orders[0].status).toBe('PAID');
    expect(db._grants).toHaveLength(1);
  });

  it('chuyển quá muộn (hơn 7 ngày sau khi đơn hết hạn) → không tự cấp, ghi lại để xử lý tay', async () => {
    const o = await newOrder();
    const late = new Date(T0.getTime() + 20 * DAY);
    const r: any = await svc.handleBankWebhook(`Apikey ${KEY}`, hook({ content: o.code }), late);
    expect(r.granted).toBe(false);
    expect(db._grants).toHaveLength(0);
    expect(db.billingEvent._rows.some((e: any) => e.type === 'PAYMENT_REJECTED')).toBe(true);
  });
});
