import { avatarKey, detectImageExt, validateAvatarFile } from './avatar.util';

describe('avatar.util', () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const id = '123e4567-e89b-12d3-a456-426614174000';

  it('nhận diện ảnh theo chữ ký file', () => {
    expect(detectImageExt(jpg)).toBe('jpg');
    expect(detectImageExt(png)).toBe('png');
    expect(detectImageExt(webp)).toBe('webp');
    expect(detectImageExt(Buffer.from('<?php echo 1;'))).toBeNull();
  });

  it('từ chối thiếu file, quá 2 MB và file không phải ảnh', () => {
    expect(() => validateAvatarFile(undefined)).toThrow('Chưa chọn ảnh');
    expect(() => validateAvatarFile({ buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0xff) })).toThrow('2 MB');
    expect(() => validateAvatarFile({ buffer: Buffer.from('not an image') })).toThrow('JPG, PNG');
    expect(validateAvatarFile({ buffer: jpg })).toBe('jpg');
  });

  it('khoá tệp chứa mã người dùng và đuôi theo nội dung', () => {
    expect(avatarKey(id, 'png', 1700000000000)).toBe(`avatars/${id}-1700000000000.png`);
  });
});
