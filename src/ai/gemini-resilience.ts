/**
 * Gemini hay trả 503 "high demand" / 429 / hết thời gian chờ ở các mô hình preview. Thay vì báo lỗi ngay,
 * thử lần lượt chuỗi mô hình dự phòng; chỉ lỗi tạm thời mới chuyển mô hình, lỗi do yêu cầu (400, an toàn nội dung...) ném ngay.
 */
export const DEFAULT_FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
export const MAX_ATTEMPTS = 4;
export const ATTEMPT_TIMEOUT_MS = 15_000;

const TRANSIENT = /\b(429|500|502|503|504)\b|high demand|overloaded|unavailable|timeout|timed out|aborted|fetch failed|econn|enotfound|socket|network|resource.?exhausted/i;

export function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return TRANSIENT.test(msg);
}

/** Mô hình vừa lỗi tạm thời được cho "nghỉ" một lúc: lần gọi sau thử các mô hình khác trước, đỡ chờ lại mô hình đang quá tải. */
export const COOLDOWN_MS = 60_000;
const cooldownUntil = new Map<string, number>();
export function markModelFailed(name: string, now = Date.now()): void { cooldownUntil.set(name, now + COOLDOWN_MS); }
export function resetModelCooldowns(): void { cooldownUntil.clear(); }

/** Chuỗi mô hình cần thử: mô hình chính trước, rồi các mô hình dự phòng không trùng; mô hình đang nghỉ xếp cuối. Tối đa MAX_ATTEMPTS. */
export function modelChain(primary: string, fallbacks: string[], now = Date.now()): string[] {
  const all = [primary, ...fallbacks.filter((m) => m && m !== primary)];
  const ready = all.filter((m) => (cooldownUntil.get(m) ?? 0) <= now);
  const resting = all.filter((m) => (cooldownUntil.get(m) ?? 0) > now);
  return [...ready, ...resting].slice(0, MAX_ATTEMPTS);
}

export function parseFallbackModels(raw: string | undefined): string[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_FALLBACK_MODELS;
}

/**
 * Chạy `call(modelName)` theo chuỗi mô hình. Trả kết quả đầu tiên thành công; lỗi không tạm thời ném ngay;
 * hết chuỗi thì ném lỗi cuối. `onFallback` để ghi log khi chuyển mô hình.
 */
export async function withModelFallback<T>(
  chain: string[],
  call: (modelName: string) => Promise<T>,
  onFallback?: (from: string, err: unknown) => void,
): Promise<T> {
  let last: unknown;
  for (const name of chain) {
    try {
      return await call(name);
    } catch (err) {
      last = err;
      if (!isTransientGeminiError(err)) throw err;
      markModelFailed(name);
      onFallback?.(name, err);
    }
  }
  throw last;
}
