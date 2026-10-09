/**
 * Bộ lập thực đơn (thuần, không đụng DB): nhận TẬP MÓN ĐÃ QUA BỘ LỌC AN TOÀN (dị ứng + chế độ ăn) và dựng thực đơn
 * theo ngân sách calo từng bữa. Mọi con số dinh dưỡng lấy từ kho món, không do AI tự bịa.
 * Kết quả xác định theo `seed` nên cùng người/cùng ngày luôn ra cùng thực đơn (không nhảy lung tung khi mở lại).
 */
export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export interface PlanFood {
  name: string;
  category: string;
  servingSize: string;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
}

export interface PlanItem {
  name: string;
  servingSize: string;
  /** Số phần. Tổng của món = giá trị trên 1 phần × quantity. */
  quantity: number;
  /** Giá trị trên 1 phần (để app ghi vào nhật ký đúng quy ước calo-trên-1-quantity). */
  unit: { calories: number; protein: number; carb: number; fat: number };
  calories: number;
  protein: number;
  carb: number;
  fat: number;
}

export interface PlanSlot {
  mealType: MealSlot;
  budgetCalories: number;
  items: PlanItem[];
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  /** true khi tổng bữa lệch ngân sách không quá 15%. */
  withinTolerance: boolean;
}

export interface DayPlan {
  slots: PlanSlot[];
  totals: { calories: number; protein: number; carb: number; fat: number };
}

export interface PlanOptions {
  targetCalories: number;
  macroStyle?: string | null;
  goal?: string | null;
  /** Số bữa/ngày người dùng muốn: <= 3 không có bữa phụ. */
  mealsPerDay?: number | null;
  /** Hạt giống xác định: cùng seed cho cùng thực đơn. */
  seed: string;
  /** Món đã dùng gần đây, ưu tiên không lặp lại. */
  avoid?: Set<string>;
  /** Ngân sách từng bữa (ghi đè phân bổ mặc định), ví dụ phần còn lại sau khi đã ăn một phần. */
  slotBudgets?: Partial<Record<MealSlot, number>>;
  /** Chỉ lập các bữa này (mặc định tất cả bữa theo mealsPerDay). */
  onlySlots?: MealSlot[];
}

const CAT = {
  STARCH: 'Cơm - Tinh bột',
  NOODLE: 'Bún - Phở - Mì',
  SEAFOOD: 'Hải sản - Cá',
  VEG: 'Rau củ - Canh',
  MEAT: 'Thịt - Gia cầm',
  FRUIT: 'Trái cây - Đồ uống',
} as const;

/** Tỷ lệ calo mỗi bữa (tham khảo, đặc tả 1.6). */
export const SLOT_SHARES_WITH_SNACK: Record<MealSlot, number> = {
  BREAKFAST: 0.25,
  LUNCH: 0.35,
  DINNER: 0.3,
  SNACK: 0.1,
};
export const SLOT_SHARES_NO_SNACK: Record<MealSlot, number> = {
  BREAKFAST: 0.28,
  LUNCH: 0.37,
  DINNER: 0.35,
  SNACK: 0,
};

const TOLERANCE = 0.15;
const QTY_STEP = 0.25;
const QTY_MIN = 0.5;
const QTY_MAX = 3;
/** Hệ số tối đa khi co giãn khẩu phần để bám ngân sách. */
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;

// ------------------------------------------------------------------ RNG xác định
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
function proteinDensity(f: PlanFood) {
  return f.calories > 0 ? (f.protein * 4) / f.calories : 0;
}

/** Số bữa được lập theo sở thích số bữa/ngày. */
export function slotsFor(mealsPerDay?: number | null): MealSlot[] {
  return (mealsPerDay ?? 3) >= 4
    ? ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']
    : ['BREAKFAST', 'LUNCH', 'DINNER'];
}

export function slotBudgetsFor(
  targetCalories: number,
  mealsPerDay?: number | null,
): Record<MealSlot, number> {
  const shares = (mealsPerDay ?? 3) >= 4 ? SLOT_SHARES_WITH_SNACK : SLOT_SHARES_NO_SNACK;
  return {
    BREAKFAST: Math.round(targetCalories * shares.BREAKFAST),
    LUNCH: Math.round(targetCalories * shares.LUNCH),
    DINNER: Math.round(targetCalories * shares.DINNER),
    SNACK: Math.round(targetCalories * shares.SNACK),
  };
}

/** Tập món đủ để lập thực đơn có ý nghĩa; ít hơn thì báo người dùng tập món đang hạn chế (đặc tả 1.11). */
export const MIN_FOODS_FOR_PLAN = 12;

/** Món giàu đạm: từ 20% năng lượng đến từ protein VÀ có ít nhất 8 g đạm/phần (rau ít calo không tính). */
const PROTEIN_RICH = 0.2;
const PROTEIN_RICH_MIN_GRAMS = 8;
function isProteinRich(f: PlanFood) {
  return proteinDensity(f) >= PROTEIN_RICH && f.protein >= PROTEIN_RICH_MIN_GRAMS;
}

/**
 * Tập món đang hạn chế khi quá ít món, hoặc không còn món giàu đạm nào (không thể dựng bữa cân đối),
 * ví dụ ăn chay thuần kèm nhiều dị ứng.
 */
export function isLimitedChoice(foods: PlanFood[]): boolean {
  return foods.length < MIN_FOODS_FOR_PLAN || !foods.some(isProteinRich);
}

function toItem(food: PlanFood, quantity: number): PlanItem {
  return {
    name: food.name,
    servingSize: food.servingSize,
    quantity,
    unit: {
      calories: food.calories,
      protein: food.protein,
      carb: food.carb,
      fat: food.fat,
    },
    calories: round1(food.calories * quantity),
    protein: round1(food.protein * quantity),
    carb: round1(food.carb * quantity),
    fat: round1(food.fat * quantity),
  };
}

function sumItems(items: PlanItem[]) {
  return items.reduce(
    (a, i) => ({
      calories: a.calories + i.calories,
      protein: a.protein + i.protein,
      carb: a.carb + i.carb,
      fat: a.fat + i.fat,
    }),
    { calories: 0, protein: 0, carb: 0, fat: 0 },
  );
}

export function buildDayPlan(foods: PlanFood[], opts: PlanOptions): DayPlan {
  const budgets = { ...slotBudgetsFor(opts.targetCalories, opts.mealsPerDay), ...opts.slotBudgets };
  const slots = opts.onlySlots ?? slotsFor(opts.mealsPerDay);
  const avoid = opts.avoid ?? new Set<string>();
  const used = new Set<string>(); // không lặp món trong cùng ngày
  const style = opts.macroStyle ?? 'BALANCED';
  const isKeto = style === 'KETO';
  const lowCarb = style === 'LOW_CARB_HIGH_FAT';

  const byCat = (cat: string) => foods.filter((f) => f.category === cat);
  const pools = {
    starch: byCat(CAT.STARCH),
    noodle: byCat(CAT.NOODLE),
    veg: byCat(CAT.VEG),
    fruit: byCat(CAT.FRUIT),
    protein: [...byCat(CAT.MEAT), ...byCat(CAT.SEAFOOD)],
  };
  // Người ăn chay thuần không có thịt/cá: lấy món giàu đạm từ các nhóm còn lại (ví dụ đậu hũ)
  if (pools.protein.length === 0) {
    pools.protein = foods.filter(isProteinRich);
  }

  const result: PlanSlot[] = [];
  for (const mealType of slots) {
    const rng = mulberry32(hashSeed(`${opts.seed}|${mealType}`));
    const budget = budgets[mealType];

    const pick = (pool: PlanFood[], preferProtein = false): PlanFood | null => {
      let candidates = pool.filter((f) => !used.has(f.name) && !avoid.has(f.name));
      if (candidates.length === 0) candidates = pool.filter((f) => !used.has(f.name));
      if (candidates.length === 0) return null;
      if (preferProtein) {
        candidates = [...candidates].sort((a, b) => proteinDensity(b) - proteinDensity(a));
        candidates = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
      }
      const food = candidates[Math.floor(rng() * candidates.length)];
      used.add(food.name);
      return food;
    };

    // Thành phần của bữa theo loại bữa và phong cách macro
    const parts: { food: PlanFood; baseQty: number }[] = [];
    const add = (food: PlanFood | null, baseQty = 1) => {
      if (food) parts.push({ food, baseQty });
    };

    if (mealType === 'BREAKFAST') {
      if (isKeto) {
        add(pick(pools.protein, true));
        add(pick(pools.veg));
      } else {
        add(pick(pools.noodle.length ? pools.noodle : pools.starch), lowCarb ? 0.75 : 1);
        if (!lowCarb) add(pick(pools.fruit));
      }
    } else if (mealType === 'SNACK') {
      add(pick(pools.fruit));
      if (budget > 120) add(pick(pools.fruit));
    } else {
      // Bữa chính: tinh bột (trừ keto) + món đạm + rau
      if (!isKeto) add(pick(pools.starch), lowCarb ? 0.5 : 1);
      add(pick(pools.protein, true));
      add(pick(pools.veg));
    }

    // Không chọn được món nào (tập món quá hẹp): thử bất kỳ món còn lại để bữa không trống
    if (parts.length === 0) add(pick(foods));

    // Co giãn khẩu phần để bám ngân sách bữa
    const base = parts.reduce((s, p) => s + p.food.calories * p.baseQty, 0);
    let factor = base > 0 ? budget / base : 1;
    factor = Math.min(SCALE_MAX, Math.max(SCALE_MIN, factor));
    let items = parts.map((p) => {
      const q = Math.round((p.baseQty * factor) / QTY_STEP) * QTY_STEP;
      return toItem(p.food, Math.min(QTY_MAX, Math.max(QTY_MIN, q)));
    });
    let totals = sumItems(items);

    // Còn thiếu nhiều so với ngân sách (khẩu phần đã chạm trần): thêm một món bổ sung phù hợp
    if (budget > 0 && totals.calories < budget * (1 - TOLERANCE) && items.length < 4) {
      const extraPool = mealType === 'SNACK' ? pools.fruit : isKeto ? pools.protein : pools.fruit;
      const extra = pick(extraPool.length ? extraPool : foods);
      if (extra) {
        const need = budget - totals.calories;
        const q = Math.round(Math.min(QTY_MAX, Math.max(QTY_MIN, need / Math.max(1, extra.calories))) / QTY_STEP) * QTY_STEP;
        items = [...items, toItem(extra, Math.max(QTY_MIN, q))];
        totals = sumItems(items);
      }
    }

    result.push({
      mealType,
      budgetCalories: budget,
      items,
      calories: round1(totals.calories),
      protein: round1(totals.protein),
      carb: round1(totals.carb),
      fat: round1(totals.fat),
      withinTolerance:
        budget > 0 ? Math.abs(totals.calories - budget) / budget <= TOLERANCE : items.length === 0,
    });
  }

  const dayTotals = result.reduce(
    (a, s) => ({
      calories: a.calories + s.calories,
      protein: a.protein + s.protein,
      carb: a.carb + s.carb,
      fat: a.fat + s.fat,
    }),
    { calories: 0, protein: 0, carb: 0, fat: 0 },
  );
  return {
    slots: result,
    totals: {
      calories: round1(dayTotals.calories),
      protein: round1(dayTotals.protein),
      carb: round1(dayTotals.carb),
      fat: round1(dayTotals.fat),
    },
  };
}
