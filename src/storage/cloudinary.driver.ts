import { createHash } from 'crypto';
import { assertSafeKey, StorageDriver } from './storage.service';

export interface CloudinarySettings {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Thư mục trên Cloudinary chứa mọi tệp của ứng dụng. */
  folder: string;
}

export type FetchLike = (url: string, init: { method: string; body: FormData; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Chữ ký Cloudinary: SHA-1 của các tham số (không gồm file/api_key) sắp xếp theo tên, nối bằng &, rồi cộng api_secret. */
export function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(base + apiSecret).digest('hex');
}

export function readCloudinarySettings(get: (k: string) => string | undefined): CloudinarySettings {
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  const missing = required.filter((k) => !get(k)?.trim());
  if (missing.length > 0) throw new Error(`STORAGE_DRIVER=cloudinary nhưng thiếu cấu hình: ${missing.join(', ')}`);
  const folder = (get('CLOUDINARY_FOLDER')?.trim() || 'nutriwise').replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i.test(folder)) throw new Error('CLOUDINARY_FOLDER chỉ gồm chữ, số, _, - và dấu /');
  return {
    cloudName: get('CLOUDINARY_CLOUD_NAME')!.trim(),
    apiKey: get('CLOUDINARY_API_KEY')!.trim(),
    apiSecret: get('CLOUDINARY_API_SECRET')!.trim(),
    folder,
  };
}

/**
 * Lưu tệp lên Cloudinary bằng tải lên có chữ ký (api_secret chỉ nằm ở máy chủ, không bao giờ gửi cho app).
 * Giá trị lưu vào cơ sở dữ liệu là secure_url (https) do Cloudinary trả về.
 */
export class CloudinaryStorageDriver implements StorageDriver {
  readonly kind = 'cloudinary' as const;
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    private readonly cfg: CloudinarySettings,
    private readonly doFetch: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private endpoint(action: 'upload' | 'destroy'): string {
    return `https://api.cloudinary.com/v1_1/${this.cfg.cloudName}/image/${action}`;
  }

  /** "avatars/abc-1.jpg" -> public_id "nutriwise/avatars/abc-1" (Cloudinary tự thêm đuôi theo định dạng). */
  private publicIdFor(key: string): string {
    return `${this.cfg.folder}/${key.replace(/\.[a-z0-9]+$/i, '')}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    assertSafeKey(key);
    const publicId = this.publicIdFor(key);
    const timestamp = this.now();
    const signed = { overwrite: 'true', public_id: publicId, timestamp };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(body)], { type: contentType }), key.split('/').pop());
    form.append('api_key', this.cfg.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('overwrite', 'true');
    form.append('signature', cloudinarySignature(signed, this.cfg.apiSecret));

    const res = await this.doFetch(this.endpoint('upload'), { method: 'POST', body: form, signal: AbortSignal.timeout(CloudinaryStorageDriver.TIMEOUT_MS) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json?.secure_url !== 'string') {
      throw new Error(`Cloudinary từ chối tải lên (${res.status}): ${json?.error?.message ?? 'không rõ lý do'}`);
    }
    return json.secure_url as string;
  }

  /** Suy ra public_id từ địa chỉ do chính tài khoản và thư mục của mình tạo ra; địa chỉ khác thì bỏ qua. */
  publicIdFromUrl(stored: string | null | undefined): string | null {
    if (!stored) return null;
    const prefix = `https://res.cloudinary.com/${this.cfg.cloudName}/image/upload/`;
    if (!stored.startsWith(prefix)) return null;
    const rest = stored.slice(prefix.length).replace(/^v\d+\//, '');
    const id = rest.replace(/\.[a-z0-9]+$/i, '');
    if (!id.startsWith(`${this.cfg.folder}/`) || id.includes('..')) return null;
    return id;
  }

  async remove(stored: string | null | undefined): Promise<void> {
    const publicId = this.publicIdFromUrl(stored);
    if (!publicId) return;
    try {
      const timestamp = this.now();
      const form = new FormData();
      form.append('public_id', publicId);
      form.append('api_key', this.cfg.apiKey);
      form.append('timestamp', String(timestamp));
      form.append('invalidate', 'true');
      form.append('signature', cloudinarySignature({ invalidate: 'true', public_id: publicId, timestamp }, this.cfg.apiSecret));
      await this.doFetch(this.endpoint('destroy'), { method: 'POST', body: form, signal: AbortSignal.timeout(CloudinaryStorageDriver.TIMEOUT_MS) });
    } catch {
      // không xoá được thì để lại: ảnh mồ côi không ảnh hưởng người dùng
    }
  }
}
