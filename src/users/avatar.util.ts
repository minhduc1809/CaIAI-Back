import { BadRequestException } from '@nestjs/common';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export type AvatarExt = 'jpg' | 'png' | 'webp';

/** Nhận diện loại ảnh theo chữ ký đầu file, không tin vào mimetype do client gửi. */
export function detectImageExt(buf: Buffer): AvatarExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

export function validateAvatarFile(file: { buffer?: Buffer; size?: number } | undefined): AvatarExt {
  if (!file?.buffer || file.buffer.length === 0) throw new BadRequestException('Chưa chọn ảnh');
  if (file.buffer.length > AVATAR_MAX_BYTES) throw new BadRequestException('Ảnh tối đa 2 MB');
  const ext = detectImageExt(file.buffer);
  if (!ext) throw new BadRequestException('Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP');
  return ext;
}

/** Khoá tệp chứa mã người dùng + thời điểm: đổi ảnh thì đường dẫn đổi theo, không dính bộ nhớ đệm cũ. */
export function avatarKey(userId: string, ext: AvatarExt, now = Date.now()): string {
  return `avatars/${userId}-${now}.${ext}`;
}

export const AVATAR_CONTENT_TYPE: Record<AvatarExt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
