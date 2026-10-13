import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Xác thực hai lớp TOTP cho ADMIN (BR-17.5, RFC 6238): HMAC-SHA1, 6 chữ số, bước 30 giây. Hàm thuần, không phụ thuộc
 * Nest để dễ kiểm thử với vector của RFC.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Chuỗi base32 không hợp lệ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Mã HOTP cho một bộ đếm (RFC 4226). */
export function hotp(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepOf = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SEC);

/**
 * Kiểm tra mã TOTP, chấp nhận lệch ±1 bước (đồng hồ máy lệch). Trả bước khớp, hoặc null. `lastUsedStep` chống dùng
 * lại cùng một mã (replay): chỉ nhận bước lớn hơn bước đã dùng.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
  lastUsedStep: number | null = null,
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepOf(nowMs);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = hotp(secretBase32, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, account: string, issuer = 'NutriWise Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SEC}`;
}

// ── Mã hoá bí mật khi lưu (AES-256-GCM) ──
const keyFrom = (material: string) => createHash('sha256').update(material).digest();

export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string, keyMaterial: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── Mã dự phòng dùng một lần ──
export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex'); // 10 ký tự hex
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const hashBackupCode = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
