import { UnauthorizedException } from '@nestjs/common';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  hashBackupCode,
  hotp,
  verifyTotp,
} from './totp';
import { AdminTotpService } from './services/admin-totp.service';

// Vector kiểm thử của RFC 6238 (bí mật "12345678901234567890", SHA1, lấy 6 chữ số cuối của mã 8 chữ số)
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (BR-17.5)', () => {
  it('base32 hai chiều', () => {
    const buf = Buffer.from('NutriWise-admin!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(() => base32Decode('!!!')).toThrow();
  });

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('khớp vector RFC 6238 tại t=%d', (t, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(t / 30))).toBe(expected);
  });

  it('chấp nhận lệch ±1 bước, từ chối xa hơn', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 3), now)).toBeNull();
  });

  it('chống dùng lại mã: bước đã dùng bị từ chối', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it('từ chối mã sai định dạng', () => {
    expect(verifyTotp(RFC_SECRET, '12345')).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBeNull();
  });

  it('mã hoá bí mật khi lưu: giải mã đúng với đúng khoá, sai khoá thì lỗi', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', 'khoa-1');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, 'khoa-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(enc, 'khoa-2')).toThrow();
  });

  it('mã dự phòng: 8 mã khác nhau, băm không phân biệt dấu gạch và hoa thường', () => {
    const codes = generateBackupCodes();
    expect(new Set(codes).size).toBe(8);
    expect(hashBackupCode(codes[0])).toBe(hashBackupCode(codes[0].replace('-', '').toUpperCase()));
  });
});

describe('AdminTotpService', () => {
  function build() {
    let row: any = null;
    const prisma: any = {
      adminTotp: {
        findUnique: jest.fn(async () => (row ? { ...row } : null)),
        upsert: jest.fn(async ({ update, create }: any) => (row = row ? { ...row, ...update } : { ...create, enabled: false, lastUsedStep: null })),
        update: jest.fn(async ({ data }: any) => (row = { ...row, ...data })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!row) return { count: 0 };
          if (where.OR && !where.OR.some((c: any) => (c.lastUsedStep === null ? row.lastUsedStep === null : row.lastUsedStep < c.lastUsedStep.lt))) return { count: 0 };
          if (where.backupCodeHashes && !row.backupCodeHashes.includes(where.backupCodeHashes.has)) return { count: 0 };
          row = { ...row, ...data };
          return { count: 1 };
        }),
        delete: jest.fn(async () => (row = null)),
      },
      user: { findUnique: jest.fn(async () => ({ password: require('bcrypt').hashSync('Admin@12345', 4) })) },
    };
    const config: any = { get: (k: string) => (k === 'ADMIN_TOTP_ENC_KEY' ? 'khoa-test' : undefined) };
    const audit: any = { logAction: jest.fn() };
    return { svc: new AdminTotpService(prisma, audit, config), getRow: () => row };
  }

  it('luồng đầy đủ: setup → enable → đăng nhập bằng mã → không dùng lại được mã', async () => {
    const { svc, getRow } = build();
    const { data } = await svc.setup('a1', 'admin@x.vn');
    expect(data.otpauthUrl).toContain('otpauth://totp/');
    expect(await svc.isRequired('a1')).toBe(false);

    const step = Math.floor(Date.now() / 1000 / 30);
    const en = await svc.enable('a1', hotp(data.secret, step));
    expect(en.data.backupCodes).toHaveLength(8);
    expect(await svc.isRequired('a1')).toBe(true);
    // Mã đã dùng để bật không dùng lại được để đăng nhập
    expect(await svc.verifyLogin('a1', hotp(data.secret, step))).toBe(false);
    // Mã của bước kế tiếp (trong cửa sổ ±1) dùng được đúng một lần
    const next = hotp(data.secret, step + 1);
    expect(await svc.verifyLogin('a1', next)).toBe(true);
    expect(await svc.verifyLogin('a1', next)).toBe(false);
    expect(getRow().enabled).toBe(true);
  });

  it('mã dự phòng dùng được đúng một lần', async () => {
    const { svc } = build();
    const { data } = await svc.setup('a1', 'admin@x.vn');
    const en = await svc.enable('a1', hotp(data.secret, Math.floor(Date.now() / 1000 / 30)));
    const backup = en.data.backupCodes[0];
    expect(await svc.verifyLogin('a1', backup)).toBe(true);
    expect(await svc.verifyLogin('a1', backup)).toBe(false);
    expect((await svc.status('a1')).data.backupCodesLeft).toBe(7);
  });

  it('enable với mã sai bị từ chối; tắt cần mật khẩu và mã hợp lệ', async () => {
    const { svc } = build();
    const { data } = await svc.setup('a1', 'admin@x.vn');
    await expect(svc.enable('a1', '000000')).rejects.toThrow('không đúng');
    const en = await svc.enable('a1', hotp(data.secret, Math.floor(Date.now() / 1000 / 30)));
    await expect(svc.disable('a1', 'sai-mat-khau', en.data.backupCodes[0])).rejects.toThrow('Mật khẩu');
    await expect(svc.disable('a1', 'Admin@12345', '123456')).rejects.toThrow('Mã xác thực');
    await svc.disable('a1', 'Admin@12345', en.data.backupCodes[1]);
    expect(await svc.isRequired('a1')).toBe(false);
  });

  it('thiếu mã khi đăng nhập trả lỗi TOTP_REQUIRED', () => {
    const { svc } = build();
    const err: any = svc.requiredError();
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.getResponse()).toMatchObject({ code: 'TOTP_REQUIRED' });
  });
});
