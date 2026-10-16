/** Kiểm tra JSON Gemini trả về cho nhận diện ảnh (BR-11.1 bước 4). Hàm thuần để test không cần gọi AI. */

export interface DetectedDish {
  dishName: string;
  possibleNames: string[];
  portion: { amount: number; unit: string };
  confidence: number;
}

export interface DishEstimate {
  dishName: string;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
}

export const MAX_DISHES_PER_PHOTO = 8;
const MAX_ESTIMATE_KCAL = 5000;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** null nếu sai schema (để gọi lại một lần), ngược lại danh sách món đã chuẩn hoá. */
export function parseDetectedDishes(parsed: any): DetectedDish[] | null {
  if (!parsed || parsed.isFood !== true || !Array.isArray(parsed.items)) return null;
  if (parsed.items.length === 0 || parsed.items.length > MAX_DISHES_PER_PHOTO) return null;

  const dishes: DetectedDish[] = [];
  for (const it of parsed.items) {
    if (!it || typeof it.dishName !== 'string' || !it.dishName.trim()) return null;
    const amount = it.portion?.amount;
    const unit = it.portion?.unit;
    if (!isFiniteNumber(amount) || amount <= 0 || typeof unit !== 'string' || !unit.trim()) return null;
    if (!isFiniteNumber(it.confidence)) return null;
    const possible = Array.isArray(it.possibleNames)
      ? it.possibleNames.filter((n: unknown): n is string => typeof n === 'string' && !!n.trim())
      : [];
    dishes.push({
      dishName: it.dishName.trim(),
      possibleNames: possible.slice(0, 5).map((n: string) => n.trim()),
      portion: { amount, unit: unit.trim() },
      confidence: clamp01(it.confidence),
    });
  }
  return dishes;
}

const normalizeName = (s: string) =>
  s.trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');

/** Ước tính cho món không có trong kho. null nếu thiếu món, số âm/NaN hoặc calo vô lý. */
export function parseEstimates(parsed: any, expectedNames: string[]): DishEstimate[] | null {
  if (!parsed || !Array.isArray(parsed.estimates)) return null;
  const rows: DishEstimate[] = [];
  for (const e of parsed.estimates) {
    if (!e || typeof e.dishName !== 'string') return null;
    const { calories, protein, carb, fat } = e;
    if (![calories, protein, carb, fat].every((n) => isFiniteNumber(n) && n >= 0)) return null;
    if (calories <= 0 || calories > MAX_ESTIMATE_KCAL) return null;
    rows.push({ dishName: e.dishName.trim(), calories, protein, carb, fat });
  }

  // Ưu tiên khớp theo đúng thứ tự (Gemini được yêu cầu trả đủ, đúng thứ tự danh sách đã đánh số) —
  // tránh lệ thuộc vào việc chép lại tên món y hệt từng ký tự, vốn hay lệch dấu/khoảng trắng/viết hoa.
  if (rows.length === expectedNames.length) {
    return rows.map((r, i) => ({ ...r, dishName: expectedNames[i].trim() }));
  }

  // Dự phòng: khớp theo tên đã chuẩn hoá (bỏ qua hoa/thường, khoảng trắng thừa).
  const byName = new Map<string, DishEstimate>();
  for (const r of rows) byName.set(normalizeName(r.dishName), r);
  const out: DishEstimate[] = [];
  for (const name of expectedNames) {
    const est = byName.get(normalizeName(name));
    if (!est) return null;
    out.push({ ...est, dishName: name.trim() });
  }
  return out;
}
