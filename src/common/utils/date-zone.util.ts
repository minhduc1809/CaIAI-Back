/**
 * Tiện ích ngày theo múi giờ của người dùng (BR-07.2, NT4: "ngày" luôn tính theo User.timezone).
 *
 * Quy ước:
 * - "Khoá ngày" (day key) là chuỗi `YYYY-MM-DD` theo lịch của múi giờ người dùng.
 * - Cột `@db.Date` (ví dụ Meal.logDate) được Prisma đọc/ghi như `Date` ở 00:00 UTC của khoá ngày đó:
 *   `keyToDate('2026-10-06')` = 2026-10-06T00:00:00Z. Nhờ vậy kết quả không phụ thuộc múi giờ máy chủ.
 * - Mốc thời gian thật (timestamp, ví dụ WaterLog.loggedAt) dùng `getDayBounds` để lấy
 *   [00:00 hôm nay, 00:00 ngày mai) theo múi giờ người dùng.
 */

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Trả về múi giờ IANA hợp lệ; sai hoặc thiếu thì dùng múi giờ Việt Nam. */
export function resolveTimezone(tz?: string | null): string {
  const candidate = tz || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Khoá ngày (YYYY-MM-DD) của thời điểm `at` theo múi giờ `tz`. */
export function dayKeyOf(at: Date, tz?: string | null): string {
  return at.toLocaleDateString('en-CA', { timeZone: resolveTimezone(tz) });
}

/** Khoá ngày hôm nay theo múi giờ `tz`. */
export function todayKey(tz?: string | null, now: Date = new Date()): string {
  return dayKeyOf(now, tz);
}

/** Khoá ngày → Date ở 00:00 UTC (giá trị dùng cho cột @db.Date). */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date của cột @db.Date → khoá ngày (đọc theo UTC). */
export function dateToKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/** Cộng/trừ số ngày trên một khoá ngày. */
export function addDaysToKey(key: string, days: number): string {
  return dateToKey(new Date(keyToDate(key).getTime() + days * DAY_MS));
}

/** Số ngày giữa hai khoá ngày (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / DAY_MS);
}

/** Thứ trong tuần của một khoá ngày: 1 = Thứ Hai … 7 = Chủ Nhật. */
export function isoWeekday(key: string): number {
  const d = keyToDate(key).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Khoá ngày của Thứ Hai gần nhất trước hoặc đúng ngày `key`. */
export function mondayOnOrBefore(key: string): string {
  return addDaysToKey(key, -(isoWeekday(key) - 1));
}

/**
 * Chuẩn hoá đầu vào ngày về khoá ngày:
 * - Chuỗi `YYYY-MM-DD`: dùng nguyên văn (ngày người dùng chủ động chọn).
 * - Chuỗi ISO có giờ hoặc Date: đổi sang ngày theo múi giờ `tz`.
 * - Không có: hôm nay theo `tz`.
 * Trả về null nếu không đọc được.
 */
export function normalizeDayKey(
  input: string | Date | null | undefined,
  tz?: string | null,
): string | null {
  if (input === undefined || input === null || input === '') {
    return todayKey(tz);
  }
  if (typeof input === 'string' && DAY_KEY_RE.test(input)) {
    return input;
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return dayKeyOf(d, tz);
}

/** Độ lệch (ms) của múi giờ so với UTC tại thời điểm `at`. */
export function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Thời điểm 00:00 của ngày (y, m, d) theo múi giờ `tz`. `d` có thể vượt số ngày trong tháng. */
export function zonedMidnight(
  y: number,
  m: number,
  d: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d);
  const firstPass = guess - tzOffsetMs(new Date(guess), tz);
  // Tính lại độ lệch tại thời điểm vừa ước lượng để xử lý ngày chuyển giờ mùa hè
  return new Date(guess - tzOffsetMs(new Date(firstPass), tz));
}

/** [00:00 của khoá ngày, 00:00 ngày kế tiếp) theo múi giờ `tz`, dùng cho cột timestamp. */
export function dayBoundsForKey(
  key: string,
  tz?: string | null,
): { start: Date; end: Date } {
  const zone = resolveTimezone(tz);
  const [y, m, d] = key.split('-').map(Number);
  return {
    start: zonedMidnight(y, m, d, zone),
    end: zonedMidnight(y, m, d + 1, zone),
  };
}

/** Ranh giới hôm nay theo múi giờ `tz`. */
export function getDayBounds(
  tz?: string | null,
  now: Date = new Date(),
): { startOfDay: Date; resetsAt: Date } {
  const { start, end } = dayBoundsForKey(todayKey(tz, now), tz);
  return { startOfDay: start, resetsAt: end };
}
