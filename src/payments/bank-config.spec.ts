import { PaymentsService } from './payments.service';

/** Cấu hình tài khoản nhận tiền: không bao giờ tự dùng tài khoản giả trừ khi chủ động bật cho máy dev. */
describe('Cấu hình ngân hàng của thanh toán QR', () => {
  const KEYS = [
    'NODE_ENV',
    'ALLOW_DEV_BANK_FALLBACK',
    'BANK_BIN',
    'BANK_ACCOUNT_NO',
    'BANK_ACCOUNT_NAME',
    'BANK_NAME',
  ];
  const saved: Record<string, string | undefined> = {};
  const svc = () =>
    new PaymentsService({} as any, { invalidate: jest.fn() } as any);

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('môi trường development nhưng KHÔNG bật cờ: thiếu cấu hình thì báo lỗi, không dùng tài khoản giả', () => {
    process.env.NODE_ENV = 'development';
    expect(() => svc().qrUrl({ amount: 59000, code: 'NWAAAAAAAA' })).toThrow();
    try {
      svc().qrUrl({ amount: 59000, code: 'NWAAAAAAAA' });
    } catch (e: any) {
      expect(e.getResponse().code).toBe('PAYMENT_NOT_CONFIGURED');
    }
  });

  it('môi trường khác development: bật cờ cũng không có tác dụng', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_BANK_FALLBACK = 'true';
    expect(() => svc().qrUrl({ amount: 59000, code: 'NWAAAAAAAA' })).toThrow();
  });

  it('development và bật cờ: dùng tài khoản giả để thử giao diện', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_BANK_FALLBACK = 'true';
    expect(svc().qrUrl({ amount: 59000, code: 'NWAAAAAAAA' })).toContain(
      '0388888888',
    );
  });

  it('có cấu hình thật thì luôn dùng cấu hình thật, kể cả khi cờ dev đang bật', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_BANK_FALLBACK = 'true';
    process.env.BANK_BIN = '970422';
    process.env.BANK_ACCOUNT_NO = '111222333';
    process.env.BANK_ACCOUNT_NAME = 'CHU TAI KHOAN';
    const url = svc().qrUrl({ amount: 59000, code: 'NWAAAAAAAA' });
    expect(url).toContain('970422-111222333');
    expect(url).not.toContain('0388888888');
  });
});
