/**
 * Theo dõi tỉ lệ lỗi AI trong cửa sổ trượt (BR-11.2). Khi tỉ lệ lỗi vượt ngưỡng thì báo mức ERROR để người vận
 * hành biết Gemini đang có sự cố. Chỉ báo khi đủ số mẫu tối thiểu (tránh báo oan lúc mới có 1–2 lượt gọi) và
 * không báo dồn dập (mỗi cửa sổ báo tối đa một lần).
 *
 * Ngưỡng đọc từ biến môi trường, mặc định theo đặc tả: > 20% trong 15 phút.
 */
export interface AiHealthOptions {
  ratePct: number;
  windowMs: number;
  minSamples: number;
}

export function aiHealthOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AiHealthOptions {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    ratePct: num(env.AI_ERROR_ALERT_RATE_PCT, 20),
    windowMs: num(env.AI_ERROR_ALERT_WINDOW_MIN, 15) * 60_000,
    minSamples: num(env.AI_ERROR_ALERT_MIN_SAMPLES, 5),
  };
}

export class AiHealthMonitor {
  private events: { at: number; ok: boolean }[] = [];
  private lastAlertAt = 0;

  constructor(
    private readonly onAlert: (message: string) => void,
    private readonly options: () => AiHealthOptions = () => aiHealthOptionsFromEnv(),
  ) {}

  recordSuccess(now: number = Date.now()) {
    this.record(true, now);
  }

  recordFailure(now: number = Date.now()) {
    this.record(false, now);
  }

  /** Tỉ lệ lỗi hiện tại trong cửa sổ, để kiểm tra/hiển thị. */
  snapshot(now: number = Date.now()) {
    const { windowMs } = this.options();
    this.prune(now, windowMs);
    const total = this.events.length;
    const failed = this.events.filter((e) => !e.ok).length;
    return { total, failed, ratePct: total === 0 ? 0 : (failed / total) * 100 };
  }

  private record(ok: boolean, now: number) {
    const { ratePct, windowMs, minSamples } = this.options();
    this.events.push({ at: now, ok });
    this.prune(now, windowMs);

    if (ok) return;
    const total = this.events.length;
    if (total < minSamples) return;
    const failed = this.events.filter((e) => !e.ok).length;
    const rate = (failed / total) * 100;
    if (rate > ratePct && now - this.lastAlertAt >= windowMs) {
      this.lastAlertAt = now;
      this.onAlert(
        `AI_UNAVAILABLE_RATE: ${failed}/${total} lượt gọi AI lỗi (${rate.toFixed(0)}%) trong ${Math.round(windowMs / 60_000)} phút, vượt ngưỡng ${ratePct}%`,
      );
    }
  }

  private prune(now: number, windowMs: number) {
    const from = now - windowMs;
    if (this.events.length > 0 && this.events[0].at < from) {
      this.events = this.events.filter((e) => e.at >= from);
    }
    // Chặn bộ nhớ phình khi lưu lượng rất lớn
    if (this.events.length > 5000) this.events = this.events.slice(-5000);
  }
}
