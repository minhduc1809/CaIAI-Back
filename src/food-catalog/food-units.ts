/**
 * Đơn vị khẩu phần kiểu Việt (BR-08.2).
 *
 * Số liệu trong kho tính cho MỘT khẩu phần chuẩn ("1 chén (130g)"). Từ chuỗi khẩu phần ta suy ra số gram của khẩu phần
 * và dựng sẵn hai đơn vị: chính khẩu phần chuẩn và "gram". Admin có thể bổ sung đơn vị khác cho từng món (bát nhỏ,
 * tô lớn, muỗng canh...) trong cột `units`; không bịa số gram cho món chưa có người rà soát.
 */

export interface FoodUnit {
  /** Tên hiển thị: "1 chén", "tô vừa", "gram". */
  name: string;
  /** Số gram (hoặc ml) của MỘT đơn vị này. */
  grams: number;
  isDefault: boolean;
}

export const GRAM_UNIT: FoodUnit = { name: 'gram', grams: 1, isDefault: false };

/** Giới hạn hợp lý của một đơn vị (gram/ml), chặn dữ liệu nhập nhầm. */
export const UNIT_GRAMS_MIN = 0.5;
export const UNIT_GRAMS_MAX = 5000;

export interface ParsedServing {
  /** Nhãn khẩu phần không kèm phần trong ngoặc: "1 chén". */
  label: string;
  grams: number | null;
}

/** "1 chén (130g)" → {label: "1 chén", grams: 130}; "1 ly (250ml)" → ml coi như gram (nước ≈ 1 g/ml). */
export function parseServing(servingSize: string): ParsedServing {
  const text = (servingSize ?? '').trim();
  // "1 chén (130g)" hoặc "150g" / "40g khô (~1 tô)": lấy số gram đầu tiên đi kèm đơn vị khối lượng
  const m =
    text.match(/\(([^)]*?)(\d+(?:[.,]\d+)?)\s*(g|gram|ml)\b[^)]*\)/i) ??
    text.match(/^()(\d+(?:[.,]\d+)?)\s*(g|gram|ml)\b/i);
  const grams = m ? Number(m[2].replace(',', '.')) : null;
  const stripped = text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  // Khẩu phần chỉ là một con số gram thì gọi là "1 phần"
  const label = !stripped || /^\d+(?:[.,]\d+)?\s*(g|gram|ml)\b/i.test(stripped) ? '1 phần' : stripped;
  return {
    label,
    grams: grams !== null && grams >= UNIT_GRAMS_MIN && grams <= UNIT_GRAMS_MAX ? grams : null,
  };
}

/** Kiểm tra danh sách đơn vị admin nhập; trả về danh sách đã chuẩn hoá hoặc thông báo lỗi. */
export function normalizeUnits(raw: unknown): { units?: FoodUnit[]; error?: string } {
  if (!Array.isArray(raw)) return { error: 'units phải là mảng' };
  if (raw.length > 12) return { error: 'Tối đa 12 đơn vị cho một món' };
  const seen = new Set<string>();
  const units: FoodUnit[] = [];
  for (const u of raw as any[]) {
    const name = typeof u?.name === 'string' ? u.name.trim() : '';
    const grams = Number(u?.grams);
    if (!name || name.length > 40) return { error: 'Tên đơn vị phải có 1–40 ký tự' };
    if (!Number.isFinite(grams) || grams < UNIT_GRAMS_MIN || grams > UNIT_GRAMS_MAX) {
      return { error: `Số gram của "${name}" phải từ ${UNIT_GRAMS_MIN} đến ${UNIT_GRAMS_MAX}` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `Đơn vị "${name}" bị trùng` };
    seen.add(key);
    units.push({ name, grams, isDefault: u?.isDefault === true });
  }
  // Đúng một đơn vị mặc định
  const defaults = units.filter((u) => u.isDefault).length;
  if (units.length > 0 && defaults !== 1) {
    units.forEach((u, i) => (u.isDefault = i === 0));
  }
  return { units };
}

/**
 * Danh sách đơn vị của một món: đơn vị admin đã lưu nếu có, ngược lại dựng từ khẩu phần chuẩn. Luôn kèm "gram" khi
 * biết số gram của khẩu phần để quy đổi được.
 */
export function unitsOf(servingSize: string, stored?: unknown): FoodUnit[] {
  const parsed = parseServing(servingSize);
  const base: FoodUnit[] = [];
  if (Array.isArray(stored) && stored.length > 0) {
    const n = normalizeUnits(stored);
    if (n.units) base.push(...n.units);
  }
  if (base.length === 0 && parsed.grams !== null) {
    base.push({ name: parsed.label, grams: parsed.grams, isDefault: true });
  }
  if (!base.some((u) => u.name.toLowerCase() === 'gram')) {
    if (base.length > 0) base.push({ ...GRAM_UNIT });
  }
  return base;
}

/**
 * Số "phần chuẩn" tương ứng với `amount` đơn vị đã chọn. App lưu bữa theo calo MỘT phần và `quantity` phần
 * (`calories × quantity`), nên đổi sang phần trước khi gửi. Trả null khi không quy đổi được.
 */
export function portionsFor(servingGrams: number | null, unitGrams: number, amount: number): number | null {
  if (servingGrams === null || servingGrams <= 0 || !(unitGrams > 0) || !(amount > 0)) return null;
  const portions = (unitGrams * amount) / servingGrams;
  return Math.round(portions * 1000) / 1000;
}

/** Số liệu trên 100 g, để hiển thị và so sánh giữa các món; null khi không biết số gram khẩu phần. */
export function per100g(
  servingGrams: number | null,
  values: { calories: number; protein: number; carb: number; fat: number },
) {
  if (servingGrams === null || servingGrams <= 0) return null;
  const k = 100 / servingGrams;
  const r = (v: number) => Math.round(v * k * 10) / 10;
  return { calories: r(values.calories), protein: r(values.protein), carb: r(values.carb), fat: r(values.fat) };
}
