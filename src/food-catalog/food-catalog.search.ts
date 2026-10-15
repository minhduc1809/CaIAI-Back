import { SeedFoodItem } from '../recommendations/data/vietnamese-food-database.data';
import { nameSimilarity, normalizeName } from '../ai/food-matcher';

/** Món trong kho đã nạp vào bộ nhớ: số liệu, tên gọi khác và thẻ an toàn. */
export interface CatalogFood extends SeedFoodItem {
  id: string;
  nameNormalized: string;
  aliases: string[];
  allergens: string[];
  containsMeat: boolean;
  containsFish: boolean;
  containsEgg: boolean;
  containsDairy: boolean;
  containsPork: boolean;
  /** false: chưa gắn thẻ an toàn nên bị loại khỏi mọi gợi ý (fail-closed). */
  safetyTagged: boolean;
  source: string;
  /** Đơn vị khẩu phần admin khai báo (BR-08.2); thiếu thì suy ra từ khẩu phần chuẩn. */
  units?: unknown;
}

/** Độ tương đồng tối thiểu để một món "gần giống" tên người dùng gõ vẫn được trả về (`food.searchSimilarityMin`). */
export const DEFAULT_SEARCH_SIMILARITY_MIN = 0.6;

/**
 * Tìm món trong kho (BR-08.1): không phân biệt dấu/hoa thường ("pho bo", "phở bò", "PHO" đều ra phở), tìm cả trong
 * tên gọi khác và ghi chú, kèm các món gần giống khi gõ sai nhẹ. Mọi kết quả của cách tìm cũ (chứa chuỗi gõ trong tên
 * hoặc ghi chú) vẫn có mặt; chỉ thêm kết quả, và đưa món khớp sát lên trước.
 *
 * Hạng: 0 tên bắt đầu bằng chuỗi gõ, 1 tên hoặc tên khác chứa chuỗi gõ, 2 ghi chú chứa, 3 gần giống.
 */
export function searchCatalog(
  foods: CatalogFood[],
  query?: string,
  category?: string,
  similarityMin: number = DEFAULT_SEARCH_SIMILARITY_MIN,
): CatalogFood[] {
  let pool = category ? foods.filter((f) => f.category === category) : foods;
  const q = normalizeName(query ?? '');
  if (!q) return pool;

  const ranked: { food: CatalogFood; rank: number; order: number }[] = [];
  pool.forEach((food, order) => {
    const names = [food.nameNormalized, ...food.aliases.map(normalizeName)];
    let rank = -1;
    if (names.some((n) => n.startsWith(q))) rank = 0;
    else if (names.some((n) => n.includes(q))) rank = 1;
    else if (food.note && normalizeName(food.note).includes(q)) rank = 2;
    else if ([food.name, ...food.aliases].some((n) => nameSimilarity(query ?? '', n) >= similarityMin)) rank = 3;
    if (rank >= 0) ranked.push({ food, rank, order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.map((r) => r.food);
}

/** Danh sách nhóm thực phẩm đang có trong kho (giữ thứ tự xuất hiện đầu tiên). */
export function categoriesOf(foods: CatalogFood[]): string[] {
  return [...new Set(foods.map((f) => f.category))];
}
