import { CONFIG_BY_KEY } from './config.registry';

/**
 * Giá trị tham số đang hiệu lực (BR-19.2). Là bộ nhớ đệm dùng chung trong tiến trình để cả mã không dùng được DI (hằng
 * số, hàm thuần) cũng đọc đồng bộ được: `cfg('checkin.maxChangePct')`. Chưa nạp hoặc không có ghi đè thì trả mặc định
 * trong code, nên test và lúc khởi động không cần cơ sở dữ liệu.
 */
const overrides = new Map<string, number | boolean>();
let version = 0;

/** Giá trị tham số (số). Khoá không có trong danh mục là lỗi lập trình nên ném lỗi. */
export function cfg(key: string): number {
  const def = CONFIG_BY_KEY.get(key);
  if (!def) throw new Error(`Tham số hệ thống không tồn tại: ${key}`);
  const v = overrides.has(key) ? overrides.get(key)! : def.default;
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

export function cfgBool(key: string): boolean {
  return cfg(key) !== 0;
}

export function configVersion(): number {
  return version;
}

export function setConfigSnapshot(next: Map<string, number | boolean>, ver: number): void {
  overrides.clear();
  next.forEach((v, k) => overrides.set(k, v));
  version = ver;
}

/** Chỉ dùng trong test để đưa về mặc định. */
export function resetConfigSnapshot(): void {
  overrides.clear();
  version = 0;
}
