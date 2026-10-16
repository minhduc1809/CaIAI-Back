import { CloudinaryStorageDriver, cloudinarySignature, readCloudinarySettings } from './cloudinary.driver';

describe('cloudinary driver', () => {
  const cfg = { cloudName: 'demo', apiKey: 'key123', apiSecret: 'abcd', folder: 'nutriwise' };

  it('chữ ký đúng ví dụ chính thức của Cloudinary', () => {
    const sig = cloudinarySignature({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd');
    expect(sig).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('tải lên: gửi đúng tham số có chữ ký, không gửi api_secret, trả secure_url', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/nutriwise/avatars/u-1.jpg' }),
    });
    const d = new CloudinaryStorageDriver(cfg, fetchMock as any, () => 1700000000);
    const url = await d.put('avatars/u-1.jpg', Buffer.from('img'), 'image/jpeg');
    expect(url).toBe('https://res.cloudinary.com/demo/image/upload/v1/nutriwise/avatars/u-1.jpg');
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    const form = init.body as FormData;
    expect(form.get('public_id')).toBe('nutriwise/avatars/u-1');
    expect(form.get('api_key')).toBe('key123');
    expect(form.get('signature')).toBe(cloudinarySignature({ overwrite: 'true', public_id: 'nutriwise/avatars/u-1', timestamp: 1700000000, transformation: 'c_limit,w_1024,h_1024,q_auto' }, 'abcd'));
    expect([...form.keys()]).not.toContain('api_secret');
    expect(JSON.stringify([...form.values()].filter((v) => typeof v === 'string'))).not.toContain('abcd');
  });

  it('tải lên thất bại: ném lỗi kèm lý do của Cloudinary', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Signature' } }) });
    const d = new CloudinaryStorageDriver(cfg, fetchMock as any);
    await expect(d.put('avatars/u-1.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow('Invalid Signature');
  });

  it('xoá: chỉ xoá ảnh đúng tài khoản và thư mục, lỗi mạng không làm hỏng luồng', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const d = new CloudinaryStorageDriver(cfg, fetchMock as any, () => 1700000000);
    await d.remove('https://res.cloudinary.com/other/image/upload/v1/nutriwise/avatars/u-1.jpg');
    await d.remove('https://res.cloudinary.com/demo/image/upload/v1/otherfolder/u-1.jpg');
    await d.remove('/uploads/avatars/u-1.jpg');
    await d.remove(null);
    expect(fetchMock).not.toHaveBeenCalled();
    await d.remove('https://res.cloudinary.com/demo/image/upload/v1700/nutriwise/avatars/u-1.jpg');
    expect((fetchMock.mock.calls[0][1].body as FormData).get('public_id')).toBe('nutriwise/avatars/u-1');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(d.remove('https://res.cloudinary.com/demo/image/upload/v1/nutriwise/avatars/u-2.jpg')).resolves.toBeUndefined();
  });

  it('cấu hình: báo rõ biến thiếu, thư mục mặc định nutriwise', () => {
    expect(() => readCloudinarySettings(() => undefined)).toThrow(/CLOUDINARY_CLOUD_NAME.*CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/);
    const env: Record<string, string> = { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };
    expect(readCloudinarySettings((k) => env[k]).folder).toBe('nutriwise');
    env.CLOUDINARY_FOLDER = '../x';
    expect(() => readCloudinarySettings((k) => env[k])).toThrow('CLOUDINARY_FOLDER');
  });
});
