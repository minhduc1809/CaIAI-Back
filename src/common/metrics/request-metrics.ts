/**
 * Số đo vận hành trong bộ nhớ của tiến trình (độ trễ yêu cầu, lỗi 500 gần đây) cho trang Sức khỏe hệ thống. Không lưu nội
 * dung yêu cầu, không có dữ liệu người dùng. Mất khi khởi động lại; nhiều instance thì mỗi instance có số đo riêng.
 */
interface Sample { at: number; ms: number; status: number }
interface ErrorSample { at: number; method: string; path: string; message: string }

const WINDOW_MS = 15 * 60_000;
const MAX_SAMPLES = 5000;
const MAX_ERRORS = 50;

const samples: Sample[] = [];
const errors: ErrorSample[] = [];

/** Bỏ chuỗi truy vấn và các đoạn giống mã (UUID, số dài) khỏi đường dẫn để không lộ định danh. */
export function sanitizePath(path: string): string {
  return path
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d{5,}/g, '/:n');
}

export const requestMetrics = {
  recordRequest(ms: number, status: number, now = Date.now()) {
    samples.push({ at: now, ms, status });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  },
  recordError(method: string, path: string, message: string, now = Date.now()) {
    errors.push({ at: now, method, path: sanitizePath(path), message: message.slice(0, 160) });
    if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
  },
  snapshot(now = Date.now()) {
    const recent = samples.filter((s) => now - s.at <= WINDOW_MS);
    const sorted = recent.map((s) => s.ms).sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    const dayAgo = now - 24 * 3_600_000;
    return {
      windowMinutes: WINDOW_MS / 60_000,
      requests: recent.length,
      avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
      p95Ms: pct(0.95),
      errors5xx24h: errors.filter((e) => e.at >= dayAgo).length,
      recentErrors: errors.slice(-20).reverse().map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
    };
  },
  reset() {
    samples.length = 0;
    errors.length = 0;
  },
};
