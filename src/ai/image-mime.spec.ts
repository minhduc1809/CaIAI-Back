import { sniffImageMime } from './image-mime';

const b64 = (bytes: number[]) => Buffer.from([...bytes, ...new Array(40).fill(0)]).toString('base64');

describe('sniffImageMime', () => {
  it('nhận ra JPEG/PNG/WebP/HEIC từ byte đầu, bất kể Content-Type khai báo', () => {
    expect(sniffImageMime(b64([0xff, 0xd8, 0xff, 0xe0]), 'image/*')).toBe('image/jpeg');
    expect(sniffImageMime(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/*')).toBe('image/png');
    expect(sniffImageMime(b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), undefined)).toBe('image/webp');
    expect(sniffImageMime(b64([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), 'application/octet-stream')).toBe('image/heic');
  });

  it('Content-Type chung chung như "image/*" hoặc rỗng thì dùng image/jpeg', () => {
    expect(sniffImageMime(b64([1, 2, 3, 4]), 'image/*')).toBe('image/jpeg');
    expect(sniffImageMime(b64([1, 2, 3, 4]), '')).toBe('image/jpeg');
  });

  it('không có byte đặc trưng nhưng Content-Type hợp lệ thì giữ nguyên', () => {
    expect(sniffImageMime(b64([1, 2, 3, 4]), 'image/png')).toBe('image/png');
  });
});
