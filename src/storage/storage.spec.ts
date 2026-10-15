import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertSafeKey, LocalStorageDriver, readS3Settings, S3StorageDriver } from './storage.service';

describe('storage', () => {
  const settings = {
    bucket: 'nw', region: 'auto', accessKeyId: 'k', secretAccessKey: 's',
    publicBaseUrl: 'https://cdn.example.com', forcePathStyle: false,
  };

  it('khoá tệp: chặn ../ và ký tự lạ', () => {
    expect(() => assertSafeKey('avatars/a-1.jpg')).not.toThrow();
    expect(() => assertSafeKey('../.env')).toThrow();
    expect(() => assertSafeKey('avatars/../../x')).toThrow();
    expect(() => assertSafeKey('/abs')).toThrow();
  });

  it('local: ghi, trả đường dẫn /uploads/..., xoá được và bỏ qua giá trị lạ', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-up-'));
    try {
      const d = new LocalStorageDriver(dir);
      const stored = await d.put('avatars/u-1.jpg', Buffer.from('x'), 'image/jpeg');
      expect(stored).toBe('/uploads/avatars/u-1.jpg');
      expect(readFileSync(join(dir, 'avatars/u-1.jpg')).toString()).toBe('x');
      await d.remove('https://cdn.example.com/avatars/u-1.jpg'); // không thuộc kho local
      expect(existsSync(join(dir, 'avatars/u-1.jpg'))).toBe(true);
      await d.remove(stored);
      expect(existsSync(join(dir, 'avatars/u-1.jpg'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('s3: tải lên đúng bucket/khoá/loại tệp và trả địa chỉ công khai', async () => {
    const send = jest.fn().mockResolvedValue({});
    const d = new S3StorageDriver(settings, { send } as any);
    const url = await d.put('avatars/u-1.png', Buffer.from('img'), 'image/png');
    expect(url).toBe('https://cdn.example.com/avatars/u-1.png');
    const cmd = send.mock.calls[0][0];
    expect(cmd.input).toMatchObject({ Bucket: 'nw', Key: 'avatars/u-1.png', ContentType: 'image/png' });
  });

  it('s3: chỉ xoá tệp thuộc địa chỉ công khai của mình, lỗi xoá không làm hỏng luồng', async () => {
    const send = jest.fn().mockResolvedValue({});
    const d = new S3StorageDriver(settings, { send } as any);
    await d.remove('https://other.example.com/avatars/u-1.png');
    await d.remove('/uploads/avatars/u-1.png');
    await d.remove(null);
    expect(send).not.toHaveBeenCalled();
    await d.remove('https://cdn.example.com/avatars/u-1.png');
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'nw', Key: 'avatars/u-1.png' });
    send.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(d.remove('https://cdn.example.com/avatars/u-2.png')).resolves.toBeUndefined();
  });

  it('cấu hình s3: báo rõ biến thiếu và địa chỉ công khai sai', () => {
    expect(() => readS3Settings(() => undefined)).toThrow(/S3_BUCKET.*S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY.*S3_PUBLIC_BASE_URL/);
    const env: Record<string, string> = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_PUBLIC_BASE_URL: 'cdn.example.com' };
    expect(() => readS3Settings((k) => env[k])).toThrow('https://');
    env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com//';
    const ok = readS3Settings((k) => env[k]);
    expect(ok.publicBaseUrl).toBe('https://cdn.example.com');
    expect(ok.region).toBe('auto');
  });
});
