/** Kiểm tra JSON Gemini trả về khi ĐỌC thực đơn (BR-11.3), và xếp hạng món gợi ý. Hàm thuần để test không cần AI. */

export const MAX_MENU_ITEMS = 30;
export const DEFAULT_MAX_SUGGESTIONS = 3;

export interface DetectedMenuItem {
  name: string;
  price?: string;
  description: string;
  possibleNames: string[];
}

export interface ParsedMenu {
  restaurantName: string | null;
  items: DetectedMenuItem[];
}

const text = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * null nếu sai schema (để gọi lại một lần). Món không có tên bị bỏ qua; quá 30 món thì lấy 30 món đầu
 * (thực đơn dài vẫn dùng được thay vì báo lỗi).
 */
export function parseMenu(parsed: any): ParsedMenu | null {
  if (!parsed || parsed.isMenu !== true || !Array.isArray(parsed.items)) return null;
  const items: DetectedMenuItem[] = [];
  for (const raw of parsed.items) {
    const name = text(raw?.name, 120);
    if (!name) continue;
    const possible = Array.isArray(raw?.possibleNames)
      ? raw.possibleNames.map((n: unknown) => text(n, 120)).filter(Boolean).slice(0, 4)
      : [];
    items.push({
      name,
      price: text(raw?.price, 40) || undefined,
      description: text(raw?.description, 240),
      possibleNames: possible,
    });
    if (items.length >= MAX_MENU_ITEMS) break;
  }
  if (items.length === 0) return null;
  return { restaurantName: text(parsed.restaurantName, 80) || null, items };
}

export interface RankableItem {
  index: number;
  calories: number;
  protein: number;
}

/**
 * Chọn tối đa `max` món vừa với phần còn lại trong ngày. Chỉ xét món đã qua lọc cứng dị ứng/chế độ ăn và có số liệu.
 * Món vượt quá 110% calo còn lại bị loại; còn lại xếp theo độ gần calo còn lại (tối đa 700 kcal cho một bữa) và
 * thiếu hụt đạm. Không còn calo thì không đề xuất món nào.
 */
export function rankMenuItems(
  items: RankableItem[],
  remainingCalories: number,
  remainingProtein: number,
  max: number = DEFAULT_MAX_SUGGESTIONS,
): number[] {
  if (remainingCalories <= 0 || max <= 0) return [];
  const targetCal = Math.max(100, Math.min(remainingCalories, 700));
  const targetPro = Math.max(0, Math.min(remainingProtein, 50));
  return items
    .filter((i) => i.calories > 0 && i.calories <= remainingCalories * 1.1)
    .map((i) => ({
      index: i.index,
      cost:
        Math.abs(i.calories - targetCal) / targetCal +
        (targetPro > 0 ? (Math.max(0, targetPro - i.protein) / targetPro) * 0.8 : 0),
    }))
    .sort((a, b) => a.cost - b.cost || a.index - b.index)
    .slice(0, max)
    .map((x) => x.index);
}
