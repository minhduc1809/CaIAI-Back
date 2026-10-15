/**
 * Xác định loại ảnh thật từ vài byte đầu (magic bytes) để gửi cho Gemini đúng `mimeType`.
 * Trước đây dùng nguyên Content-Type do client khai báo: app Android gửi "image/*" nên Gemini trả 400 và người dùng
 * thấy lời báo sai "ảnh không đúng định dạng JPG/PNG/WebP" dù ảnh hoàn toàn bình thường.
 */
export function sniffImageMime(base64: string, declared?: string | null): string {
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, 64), 'base64');
  } catch {
    head = Buffer.alloc(0);
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  const d = (declared ?? '').toLowerCase();
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(d)) return d;
  return 'image/jpeg'; // "image/*", rỗng hoặc lạ: app luôn nén ảnh về JPEG trước khi gửi
}
