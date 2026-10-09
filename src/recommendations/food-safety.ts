import {
  SeedFoodItem,
  VIETNAMESE_FOODS_DATA,
} from './data/vietnamese-food-database.data';
import { FOOD_SAFETY_TAGS, FoodSafetyTags } from './data/food-safety-tags.data';

export interface FoodSafetyRules {
  /** OMNIVORE | PESCATARIAN | VEGETARIAN | VEGAN | HALAL. Giá trị lạ hoặc thiếu được coi là OMNIVORE. */
  dietType?: string | null;
  /** Danh sách dị ứng của user (DAIRY, EGG, FISH, ...). "NONE" và giá trị rỗng bị bỏ qua. */
  allergies?: string[] | null;
}

export interface SafeFood extends SeedFoodItem {
  safety: FoodSafetyTags;
}

/**
 * BR-11.5: món có được phép gợi ý cho user không.
 * - Dị ứng: loại món có allergen trùng với dị ứng của user.
 * - VEGETARIAN loại thịt và cá/hải sản; VEGAN loại thêm trứng và sữa;
 *   PESCATARIAN loại thịt; HALAL loại thịt heo.
 */
export function isFoodAllowed(
  tags: FoodSafetyTags,
  rules: FoodSafetyRules,
): boolean {
  const allergies = new Set(
    (rules.allergies ?? []).filter((a) => a && a !== 'NONE'),
  );
  if (tags.allergens.some((a) => allergies.has(a))) return false;

  switch (rules.dietType) {
    case 'VEGETARIAN':
      return !tags.containsMeat && !tags.containsFish;
    case 'VEGAN':
      return (
        !tags.containsMeat &&
        !tags.containsFish &&
        !tags.containsEgg &&
        !tags.containsDairy
      );
    case 'PESCATARIAN':
      return !tags.containsMeat;
    case 'HALAL':
      return !tags.containsPork;
    default:
      return true;
  }
}

/**
 * Danh sách món được phép gợi ý cho user. Món chưa có thẻ an toàn bị loại (fail-closed) để món mới
 * thêm vào kho mà quên gắn thẻ không bao giờ lọt vào gợi ý.
 */
export function getAllowedFoods(rules: FoodSafetyRules): SafeFood[] {
  const result: SafeFood[] = [];
  for (const food of VIETNAMESE_FOODS_DATA) {
    const safety = FOOD_SAFETY_TAGS[food.name];
    if (safety && isFoodAllowed(safety, rules)) {
      result.push({ ...food, safety });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Món KHÔNG nằm trong kho (ví dụ món đọc từ ảnh thực đơn nhà hàng): chỉ có tên và mô tả, nên nhận diện
// theo từ khoá tiếng Việt CÓ DẤU. Đây là cảnh báo thận trọng (có thể báo thừa, ví dụ "bơ" không bị nhầm "bò"
// nhưng "mì" có thể là mì không gluten), không thay được thông tin thành phần thật của quán.
// ---------------------------------------------------------------------------
const MEAT_WORDS = ['thịt', 'bò', 'heo', 'lợn', 'gà', 'vịt', 'ngan', 'dê', 'sườn', 'chả', 'giò', 'nem', 'ba chỉ', 'lòng', 'dồi'];
const FISH_WORDS = ['cá', 'tôm', 'cua', 'ghẹ', 'mực', 'ốc', 'sò', 'nghêu', 'ngao', 'hến', 'hải sản'];
const PORK_WORDS = ['heo', 'lợn', 'sườn', 'chả', 'giò', 'nem', 'ba chỉ', 'dồi', 'xúc xích', 'thịt xông khói'];
const EGG_WORDS = ['trứng'];
const DAIRY_WORDS = ['sữa', 'phô mai', 'pho mát', 'kem', 'bơ sữa'];

const ALLERGEN_WORDS: Record<string, string[]> = {
  DAIRY: DAIRY_WORDS,
  EGG: EGG_WORDS,
  FISH: ['cá', 'nước mắm', 'mắm'],
  SHELLFISH: ['tôm', 'cua', 'ghẹ', 'mực', 'ốc', 'sò', 'nghêu', 'ngao', 'hến', 'hải sản', 'mắm tôm'],
  GLUTEN: ['bánh mì', 'mì', 'lúa mì', 'bột mì', 'bia'],
  PEANUT: ['đậu phộng', 'lạc'],
  SESAME: ['mè', 'vừng'],
  SOY: ['đậu phụ', 'đậu hũ', 'đậu nành', 'tàu hũ', 'xì dầu', 'nước tương', 'tương'],
  TREE_NUT: ['hạt điều', 'hạnh nhân', 'óc chó', 'hạt dẻ'],
};

const ALLERGEN_LABEL: Record<string, string> = {
  DAIRY: 'sữa', EGG: 'trứng', FISH: 'cá', SHELLFISH: 'hải sản có vỏ', GLUTEN: 'gluten',
  PEANUT: 'đậu phộng', SESAME: 'mè', SOY: 'đậu nành', TREE_NUT: 'hạt cây',
};

function hasWord(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u').test(text));
}

/** Trả về các lý do (tiếng Việt) khiến món có thể không phù hợp với user; rỗng nghĩa là không phát hiện vi phạm. */
export function detectTextViolations(
  text: string,
  rules: FoodSafetyRules,
): string[] {
  const t = (text || '').toLowerCase();
  const reasons: string[] = [];
  for (const a of new Set((rules.allergies ?? []).filter((x) => x && x !== 'NONE'))) {
    if (ALLERGEN_WORDS[a] && hasWord(t, ALLERGEN_WORDS[a])) {
      reasons.push(`có thể chứa ${ALLERGEN_LABEL[a] ?? a} (bạn bị dị ứng)`);
    }
  }
  const diet = rules.dietType;
  if ((diet === 'VEGETARIAN' || diet === 'VEGAN') && hasWord(t, MEAT_WORDS)) reasons.push('có thịt');
  if ((diet === 'VEGETARIAN' || diet === 'VEGAN') && hasWord(t, FISH_WORDS)) reasons.push('có cá/hải sản');
  if (diet === 'VEGAN' && hasWord(t, EGG_WORDS)) reasons.push('có trứng');
  if (diet === 'VEGAN' && hasWord(t, DAIRY_WORDS)) reasons.push('có sữa');
  if (diet === 'PESCATARIAN' && hasWord(t, MEAT_WORDS)) reasons.push('có thịt');
  if (diet === 'HALAL' && hasWord(t, PORK_WORDS)) reasons.push('có thịt heo');
  return reasons;
}
