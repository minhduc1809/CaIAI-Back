import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { requestMetrics } from '../../common/metrics/request-metrics';

export type Level = 'OK' | 'WARN' | 'DOWN' | 'UNKNOWN';
export interface Check { level: Level; detail: string; latencyMs?: number | null }

/** Ngưỡng cảnh báo tỉ lệ lỗi AI trong 24 giờ; trùng biến cấu hình dùng cho cảnh báo của dịch vụ AI. */
const DEFAULT_AI_ERROR_ALERT_PCT = 25;

/**
 * Trang Sức khỏe hệ thống (chỉ đọc). Chỉ trả những gì backend thực sự đo được hoặc đọc được từ cấu hình; không trả khoá, chuỗi
 * kết nối hay dữ liệu nhạy cảm. Dịch vụ ngoài (AI, email, Google Play) chỉ báo "đã cấu hình" và tỉ lệ lỗi thật, không gọi thử
 * để tránh tốn phí và lộ thông tin.
 */
@Injectable()
export class AdminSystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async database(): Promise<Check & { migrations?: number | null; lastMigration?: string | null }> {
    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - t0;
      let migrations: number | null = null;
      let lastMigration: string | null = null;
      try {
        const rows = await this.prisma.$queryRaw<{ n: number; last: string | null }[]>`
          SELECT COUNT(*)::int AS n, MAX(migration_name) AS last FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
        migrations = rows[0]?.n ?? null;
        lastMigration = rows[0]?.last ?? null;
      } catch {
        // bảng migration không đọc được thì bỏ qua, kết nối vẫn tốt
      }
      return { level: latency > 1000 ? 'WARN' : 'OK', detail: latency > 1000 ? 'Truy vấn chậm' : 'Kết nối tốt', latencyMs: latency, migrations, lastMigration };
    } catch {
      return { level: 'DOWN', detail: 'Không truy vấn được cơ sở dữ liệu', latencyMs: null };
    }
  }

  private async ai(now: Date): Promise<Check & { calls24h: number; errors24h: number; errorRatePct: number | null }> {
    const configured = !!this.config.get<string>('GEMINI_API_KEY');
    const since = new Date(now.getTime() - 24 * 3_600_000);
    let calls = 0;
    let errors = 0;
    try {
      [calls, errors] = await Promise.all([
        this.prisma.apiUsageLog.count({ where: { createdAt: { gte: since } } }),
        this.prisma.apiUsageLog.count({ where: { createdAt: { gte: since }, status: 'ERROR' } }),
      ]);
    } catch {
      // không đọc được nhật ký dùng AI
    }
    const rate = calls ? Math.round((errors / calls) * 1000) / 10 : null;
    const threshold = Number(this.config.get<string>('AI_ERROR_ALERT_RATE_PCT')) || DEFAULT_AI_ERROR_ALERT_PCT;
    let level: Level = 'OK';
    let detail = 'Đã cấu hình khoá AI';
    if (!configured) {
      level = 'WARN';
      detail = 'Chưa cấu hình khoá AI: app dùng chế độ dự phòng';
    } else if (rate !== null && rate >= threshold) {
      level = 'WARN';
      detail = `Tỉ lệ lỗi 24 giờ ${rate}% vượt ngưỡng ${threshold}%`;
    } else if (calls === 0) {
      detail = 'Đã cấu hình khoá AI, chưa có lời gọi trong 24 giờ';
    }
    return { level, detail, calls24h: calls, errors24h: errors, errorRatePct: rate };
  }

  private email(): Check {
    return this.config.get<string>('SMTP_HOST') ? { level: 'OK', detail: 'Đã cấu hình SMTP (chưa gửi thử để tránh gửi thư thật)' } : { level: 'WARN', detail: 'Chưa cấu hình SMTP: không gửi được mã xác thực' };
  }

  private googlePlay(): Check {
    return this.config.get<string>('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
      ? { level: 'OK', detail: 'Đã cấu hình tài khoản dịch vụ Google Play' }
      : { level: 'UNKNOWN', detail: 'Chưa cấu hình Google Play (đang dùng thanh toán QR)' };
  }

  private appVersion(): string | null {
    try {
      return (JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }

  /** Lần sao lưu cuối: đọc từ file trạng thái do tác vụ sao lưu ghi ra (BACKUP_STATUS_FILE, JSON có `at`). */
  private backup(): { lastBackupAt: string | null; note: string } {
    const file = this.config.get<string>('BACKUP_STATUS_FILE');
    if (!file) return { lastBackupAt: null, note: 'Chưa cấu hình BACKUP_STATUS_FILE nên không biết lần sao lưu cuối' };
    try {
      if (!existsSync(file)) return { lastBackupAt: null, note: 'Chưa thấy file trạng thái sao lưu' };
      const data = JSON.parse(readFileSync(file, 'utf8')) as { at?: string };
      return { lastBackupAt: data.at ?? null, note: data.at ? 'Đọc từ file trạng thái sao lưu' : 'File trạng thái không có trường at' };
    } catch {
      return { lastBackupAt: null, note: 'Không đọc được file trạng thái sao lưu' };
    }
  }

  async getHealth(now: Date = new Date()) {
    const [database, ai] = await Promise.all([this.database(), this.ai(now)]);
    const http = requestMetrics.snapshot(now.getTime());
    const levels = [database.level, ai.level];
    return {
      checkedAt: now.toISOString(),
      overall: levels.includes('DOWN') ? 'DOWN' : levels.includes('WARN') ? 'WARN' : 'OK',
      database,
      ai,
      email: this.email(),
      googlePlay: this.googlePlay(),
      http,
      backup: this.backup(),
      runtime: {
        version: this.appVersion(),
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        environment: this.config.get<string>('NODE_ENV') ?? 'development',
      },
    };
  }
}
