import { cfg } from '../system-config/config.holder';
import {
  SeedFoodItem,
  VIETNAMESE_FOODS_DATA,
} from '../recommendations/data/vietnamese-food-database.data';
import { FOOD_ALIASES } from './food-aliases.data';

/** Độ tương đồng tối thiểu để coi là "khớp kho" (BR-11.1, `ai.catalogMatchThreshold`). */
export const DEFAULT_MATCH_THRESHOLD = 0.6;
/** Số món gần nhất trả về để người dùng đổi khi AI nhận sai. */
export const ALTERNATIVES_COUNT = 3;

const STOPWORDS = new Set([
  'mon', 'an', 'voi', 'va', 'kem', 'dia', 'to', 'bat', 'chen', 'phan', 'suat', 'ly', 'mot', 'cai',
]);

/** Bỏ dấu, chữ thường, bỏ ký tự đặc biệt, gom khoảng trắng. "Phở Bò (tái)" -> "pho bo tai". */
export function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t && !STOPWORDS.has(t));
}

function bigrams(s: string): string[] {
  const c = s.replace(/ /g, '');
  const out: string[] = [];
  for (let i = 0; i < c.length - 1; i++) out.push(c.slice(i, i + 2));
  return out;
}

function diceOf(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const y of b) {
    const n = counts.get(y) ?? 0;
    if (n > 0) {
      inter++;
      counts.set(y, n - 1);
    }
  }
  return (2 * inter) / (a.length + b.length);
}

/** Độ tương đồng 0–1 giữa tên truy vấn (a, từ AI) và tên khoá của món trong kho (b). Không đối xứng. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  if (ta.length === 0 || tb.length === 0) return 0;

  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const tokenDice = (2 * inter) / (sa.size + sb.size);

  // Một tên nằm trọn trong tên kia, trừ theo độ chênh dài.
  // - Truy vấn ngắn hơn khoá ("pho bo" trong "pho bo tai nac"): AI nói chung chung hơn kho, vẫn khớp khá.
  // - Truy vấn DÀI hơn khoá ("com tam suon bi cha" chứa "com"): truy vấn cụ thể hơn nên rất có thể là món
  //   khác, trừ điểm mạnh để không gán nhầm vào món chung chung.
  let subset = 0;
  if ([...sa].every((t) => sb.has(t))) {
    subset = 0.5 + 0.5 * (sa.size / sb.size);
  } else if ([...sb].every((t) => sa.has(t))) {
    subset = 0.35 + 0.65 * (sb.size / sa.size);
  }

  // Bắt lỗi chính tả nhẹ / từ ghép dính ("banhmi")
  const charDice = diceOf(bigrams(tokensKey(ta)), bigrams(tokensKey(tb)));

  return Math.max(tokenDice, subset, charDice * 0.95);
}

function tokensKey(t: string[]): string {
  return t.join(' ');
}

export interface FoodMatch {
  food: SeedFoodItem;
  /** Khoá ổn định của món trong kho (tên chuẩn hoá), dùng làm sourceId. */
  id: string;
  score: number;
}

interface IndexedFood {
  food: SeedFoodItem;
  id: string;
  keys: string[];
}

/** Hàm tìm món theo tên trong kho. Khi có bảng FoodCatalog (E5) chỉ cần đổi nguồn dữ liệu, giữ nguyên giao diện. */
export class FoodMatcher {
  private readonly index: IndexedFood[];

  constructor(
    foods: SeedFoodItem[] = VIETNAMESE_FOODS_DATA,
    aliases: Record<string, string[]> = FOOD_ALIASES,
  ) {
    this.index = foods.map((food) => ({
      food,
      id: normalizeName(food.name).replace(/ /g, '-'),
      keys: [food.name, ...(aliases[food.name] ?? [])],
    }));
  }

  /** Điểm cao nhất của một tên so với tên chính + alias của món. */
  private scoreFor(query: string, item: IndexedFood): number {
    let best = 0;
    for (const k of item.keys) best = Math.max(best, nameSimilarity(query, k));
    return best;
  }

  /** Các món gần nhất theo điểm giảm dần (ổn định theo thứ tự kho khi bằng điểm). */
  nearest(names: string[], limit = ALTERNATIVES_COUNT): FoodMatch[] {
    const queries = names.filter((n) => normalizeName(n));
    if (queries.length === 0) return [];
    const scored = this.index.map((item, order) => ({
      item,
      order,
      score: Math.max(...queries.map((q) => this.scoreFor(q, item))),
    }));
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, limit)
      .map((s) => ({ food: s.item.food, id: s.item.id, score: s.score }));
  }

  /** Món khớp nhất nếu đạt ngưỡng, ngược lại null. */
  best(names: string[], threshold = DEFAULT_MATCH_THRESHOLD): FoodMatch | null {
    const top = this.nearest(names, 1)[0];
    return top && top.score >= threshold ? top : null;
  }
}

/** Số gram/ml của một khẩu phần kho, ví dụ "1 chén (130g)" -> 130; "100g" -> 100; "1 tô vừa" -> null. */
export function servingGrams(servingSize: string): number | null {
  const m =
    /\((?:[^)]*?)(\d+(?:[.,]\d+)?)\s*(?:g|ml)\b[^)]*\)/i.exec(servingSize) ||
    /^\s*(\d+(?:[.,]\d+)?)\s*(?:g|ml)\b/i.exec(servingSize);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MASS_UNITS = new Set(['g', 'gam', 'gram', 'ml', 'mililit']);
/** Hệ số nhân tối đa/tối thiểu so với khẩu phần chuẩn, chặn ước lượng quá vô lý. */
export const MIN_PORTION_FACTOR = 0.1;
export const MAX_PORTION_FACTOR = 8;

/**
 * Quy đổi khẩu phần AI nhìn thấy sang hệ số nhân so với khẩu phần chuẩn của món trong kho.
 * - đơn vị g/ml và kho có ghi gram: amount / gram chuẩn;
 * - đơn vị đếm (tô, chén, đĩa, quả, phần...): amount là số khẩu phần chuẩn;
 * - không quy đổi được: 1.
 */
export function portionFactor(
  portion: { amount: number; unit: string },
  catalogServing: string,
): number {
  const amount = Number(portion?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 1;
  const unit = normalizeName(portion?.unit ?? '');
  let factor = 1;
  if (MASS_UNITS.has(unit)) {
    const grams = servingGrams(catalogServing);
    factor = grams ? amount / grams : 1;
  } else {
    factor = amount;
  }
  return Math.min(MAX_PORTION_FACTOR, Math.max(MIN_PORTION_FACTOR, factor));
}

/** Kiểm tra Atwater (BR-08.4): calo công bố so với 4P + 4C + 9F. */
export function atwaterCheck(
  n: { calories: number; protein: number; carb: number; fat: number },
  tolerancePct = cfg('food.atwaterWarnPct'),
): { ok: boolean; computed: number } {
  const computed = 4 * n.protein + 4 * n.carb + 9 * n.fat;
  if (computed <= 0) return { ok: true, computed };
  const deviation = (Math.abs(n.calories - computed) / computed) * 100;
  return { ok: deviation <= tolerancePct, computed };
}
