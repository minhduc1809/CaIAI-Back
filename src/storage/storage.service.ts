import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { CloudinaryStorageDriver, readCloudinarySettings } from './cloudinary.driver';

/**
 * Nơi lưu tệp người dùng tải lên (ảnh đại diện). Hai chế độ, chọn bằng STORAGE_DRIVER:
 *  - local (mặc định, dev): ghi vào thư mục ./uploads và được phục vụ ở /uploads
 *  - cloudinary: Cloudinary (tải lên có chữ ký, trả về địa chỉ https của Cloudinary)
 *  - s3: kho tương thích S3 (AWS S3, Cloudflare R2, MinIO, Supabase Storage, DigitalOcean Spaces...)
 * `put` trả về giá trị lưu vào cơ sở dữ liệu: đường dẫn tương đối (local) hoặc địa chỉ công khai đầy đủ (s3).
 */
export interface StorageDriver {
  readonly kind: 'local' | 's3' | 'cloudinary';
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Xoá tệp theo giá trị đã lưu trong cơ sở dữ liệu; chỉ xoá tệp thuộc kho này, lỗi/không tìm thấy thì bỏ qua. */
  remove(stored: string | null | undefined): Promise<void>;
}

export const LOCAL_URL_PREFIX = '/uploads/';
export const LOCAL_DIR = join(process.cwd(), 'uploads');

/** Khoá tệp hợp lệ do hệ thống tạo ra: thư mục/tên an toàn, không có "..". */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Khoá tệp không hợp lệ: ${key}`);
}

export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string = LOCAL_DIR) {}

  async put(key: string, body: Buffer, _contentType?: string): Promise<string> {
    assertSafeKey(key);
    const full = join(this.dir, key);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
    return LOCAL_URL_PREFIX + key;
  }

  async remove(stored: string | null | undefined): Promise<void> {
    if (!stored || !stored.startsWith(LOCAL_URL_PREFIX)) return;
    const key = stored.slice(LOCAL_URL_PREFIX.length);
    try {
      assertSafeKey(key);
      await unlink(join(this.dir, key));
    } catch {
      // đã mất hoặc không hợp lệ: bỏ qua
    }
  }
}

export interface S3Settings {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Địa chỉ công khai để đọc tệp (CDN hoặc tên miền của bucket), không có dấu / ở cuối. */
  publicBaseUrl: string;
  forcePathStyle: boolean;
}

export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  private readonly client: Pick<S3Client, 'send'>;

  constructor(private readonly cfg: S3Settings, client?: Pick<S3Client, 'send'>) {
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint || undefined,
        forcePathStyle: cfg.forcePathStyle,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=604800, immutable',
      }),
    );
    return `${this.cfg.publicBaseUrl}/${key}`;
  }

  async remove(stored: string | null | undefined): Promise<void> {
    const prefix = `${this.cfg.publicBaseUrl}/`;
    if (!stored || !stored.startsWith(prefix)) return;
    const key = stored.slice(prefix.length);
    try {
      assertSafeKey(key);
      await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch {
      // không xoá được thì để lại: tệp mồ côi không ảnh hưởng người dùng
    }
  }
}

/** Đọc và kiểm tra cấu hình S3; thiếu biến nào thì báo rõ biến đó (lỗi cấu hình phải lộ ngay lúc khởi động). */
export function readS3Settings(get: (k: string) => string | undefined): S3Settings {
  const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'] as const;
  const missing = required.filter((k) => !get(k)?.trim());
  if (missing.length > 0) throw new Error(`STORAGE_DRIVER=s3 nhưng thiếu cấu hình: ${missing.join(', ')}`);
  const publicBaseUrl = get('S3_PUBLIC_BASE_URL')!.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(publicBaseUrl)) throw new Error('S3_PUBLIC_BASE_URL phải bắt đầu bằng https://');
  return {
    bucket: get('S3_BUCKET')!.trim(),
    region: get('S3_REGION')?.trim() || 'auto',
    endpoint: get('S3_ENDPOINT')?.trim() || undefined,
    accessKeyId: get('S3_ACCESS_KEY_ID')!.trim(),
    secretAccessKey: get('S3_SECRET_ACCESS_KEY')!.trim(),
    publicBaseUrl,
    forcePathStyle: (get('S3_FORCE_PATH_STYLE') ?? '').toLowerCase() === 'true',
  };
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(config: ConfigService) {
    const kind = (config.get<string>('STORAGE_DRIVER') ?? 'local').trim().toLowerCase();
    if (kind === 'cloudinary') {
      this.driver = new CloudinaryStorageDriver(readCloudinarySettings((k) => config.get<string>(k)));
    } else if (kind === 's3') {
      this.driver = new S3StorageDriver(readS3Settings((k) => config.get<string>(k)));
    } else {
      this.driver = new LocalStorageDriver();
    }
    this.logger.log(`Kho lưu trữ tệp: ${this.driver.kind}`);
  }

  get kind() {
    return this.driver.kind;
  }
  put(key: string, body: Buffer, contentType: string) {
    return this.driver.put(key, body, contentType);
  }
  remove(stored: string | null | undefined) {
    return this.driver.remove(stored);
  }
}
