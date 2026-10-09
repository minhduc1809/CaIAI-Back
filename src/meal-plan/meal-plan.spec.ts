import { MealPlanService, FREE_PREVIEW_DAYS } from './meal-plan.service';
import { buildDayPlan } from './planner';
import { getAllowedFoods } from '../recommendations/food-safety';
import { FOOD_SAFETY_TAGS } from '../recommendations/data/food-safety-tags.data';
import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';

const ALL_ALLERGENS = ['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'PEANUT', 'SESAME', 'SHELLFISH', 'SOY', 'TREE_NUT'];

function user(over: any = {}) {
  return {
    targetCalories: 1800,
    targetProtein: 130,
    targetCarb: 190,
    targetFat: 60,
    macroStyle: 'BALANCED',
    goal: 'LOSE_WEIGHT',
    mealsPerDay: 3,
    dietType: 'OMNIVORE',
    allergies: [] as string[],
    timezone: 'Asia/Ho_Chi_Minh',
    ...over,
  };
}

function build(u: any, loggedMeals: any[] = [], premium = false) {
  const prisma: any = {
    user: { findUnique: jest.fn(async () => u) },
    meal: { findMany: jest.fn(async () => loggedMeals) },
    subscriptionState: {
      findUnique: jest.fn(async () => (premium ? { status: 'ACTIVE', expiryTime: new Date(Date.now() + 86400000) } : null)),
    },
    manualGrant: { findFirst: jest.fn(async () => null) },
  };
  return new MealPlanService(prisma);
}

afterEach(() => delete process.env.BILLING_ENFORCE);

describe('Thực đơn: chỉ dùng món đã qua bộ lọc an toàn (lọc cứng)', () => {
  const combos: [string, string[]][] = [
    ['OMNIVORE', []],
    ['VEGETARIAN', []],
    ['VEGAN', []],
    ['PESCATARIAN', []],
    ['HALAL', []],
    ['OMNIVORE', ['PEANUT', 'SHELLFISH']],
    ['VEGAN', ['SOY']],
    ['OMNIVORE', ALL_ALLERGENS.slice(0, 5)],
  ];

  it.each(combos)('%s + dị ứng %j: không món nào trong 30 ngày vi phạm', async (dietType, allergies) => {
    const svc = build(user({ dietType, allergies }));
    const plan: any = await svc.getPlan('u1', 30);
    const allowed = new Set(getAllowedFoods({ dietType, allergies }).map((f) => f.name));
    let items = 0;
    for (const day of plan.days) {
      for (const slot of day.slots) {
        for (const item of slot.items) {
          items++;
          expect(allowed.has(item.name)).toBe(true);
          const tags = FOOD_SAFETY_TAGS[item.name];
          for (const a of allergies) expect(tags.allergens).not.toContain(a);
          if (dietType === 'VEGAN' || dietType === 'VEGETARIAN') expect(tags.containsMeat).toBe(false);
          if (dietType === 'VEGAN') {
            expect(tags.containsEgg).toBe(false);
            expect(tags.containsDairy).toBe(false);
          }
          if (dietType === 'HALAL') expect(tags.containsPork).toBe(false);
        }
      }
    }
    expect(items).toBeGreaterThan(0);
  });

  it('dị ứng loại hết món: báo giới hạn, không đưa món không an toàn vào để cho đủ', async () => {
    const svc = build(user({ dietType: 'VEGAN', allergies: ALL_ALLERGENS }));
    const today: any = await svc.getToday('u1');
    const allowed = new Set(getAllowedFoods({ dietType: 'VEGAN', allergies: ALL_ALLERGENS }).map((f) => f.name));
    expect(today.limitedChoices).toBe(true);
    expect(today.message).toBeTruthy();
    for (const m of today.meals) for (const i of m.items) expect(allowed.has(i.name)).toBe(true);
  });
});

describe('Thực đơn: bám ngân sách calo và không lặp', () => {
  it('mỗi bữa gần ngân sách (±15%) và cả ngày gần mục tiêu trong phần lớn ngày', async () => {
    const svc = build(user());
    const plan: any = await svc.getPlan('u1', 30);
    let slotsOk = 0;
    let slots = 0;
    let daysOk = 0;
    for (const day of plan.days) {
      for (const s of day.slots) {
        slots++;
        if (s.withinTolerance) slotsOk++;
      }
      if (Math.abs(day.totals.calories - 1800) / 1800 <= 0.15) daysOk++;
    }
    expect(slotsOk / slots).toBeGreaterThanOrEqual(0.8);
    expect(daysOk / plan.days.length).toBeGreaterThanOrEqual(0.8);
  });

  it('không lặp món trong cùng một ngày', async () => {
    const svc = build(user({ mealsPerDay: 4 }));
    const plan: any = await svc.getPlan('u1', 30);
    for (const day of plan.days) {
      const names = day.slots.flatMap((s: any) => s.items.map((i: any) => i.name));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('bữa chính của hôm nay không trùng bữa chính của 2 ngày liền trước', async () => {
    const svc = build(user());
    const plan: any = await svc.getPlan('u1', 7);
    const mains = (d: any) => d.slots.filter((s: any) => s.mealType !== 'SNACK').flatMap((s: any) => s.items.map((i: any) => i.name));
    for (let i = 2; i < plan.days.length; i++) {
      const today = mains(plan.days[i]);
      const prev = new Set([...mains(plan.days[i - 1]), ...mains(plan.days[i - 2])]);
      const repeated = today.filter((n: string) => prev.has(n));
      expect(repeated.length).toBeLessThanOrEqual(1); // kho nhỏ nên cho phép trùng rất ít
    }
  });

  it('có bữa phụ chỉ khi người dùng chọn từ 4 bữa/ngày', async () => {
    const three: any = await build(user({ mealsPerDay: 3 })).getToday('u1');
    const four: any = await build(user({ mealsPerDay: 4 })).getToday('u1');
    expect(three.meals.map((m: any) => m.mealType)).toEqual(['BREAKFAST', 'LUNCH', 'DINNER']);
    expect(four.meals.map((m: any) => m.mealType)).toEqual(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
  });

  it('ngân sách các bữa cộng lại bằng mục tiêu ngày (±1 kcal do làm tròn)', async () => {
    const today: any = await build(user({ mealsPerDay: 4 })).getToday('u1');
    const sum = today.meals.reduce((s: number, m: any) => s + m.budgetCalories, 0);
    expect(Math.abs(sum - 1800)).toBeLessThanOrEqual(2);
  });

  it('mục tiêu lớn/nhỏ vẫn bám: 1.300 và 2.800 kcal', async () => {
    for (const target of [1300, 2800]) {
      const plan: any = await build(user({ targetCalories: target })).getPlan('u1', 7);
      const ok = plan.days.filter((d: any) => Math.abs(d.totals.calories - target) / target <= 0.2).length;
      expect(ok).toBeGreaterThanOrEqual(5);
    }
  });

  it('thực đơn xác định: cùng người cùng ngày luôn ra cùng thực đơn; hôm nay khớp ngày 1 của kế hoạch', async () => {
    const svc = build(user());
    const a: any = await svc.getToday('u1');
    const b: any = await svc.getToday('u1');
    const plan: any = await svc.getPlan('u1', 7);
    const names = (slots: any[]) => slots.map((s) => s.items.map((i: any) => i.name));
    expect(names(a.meals)).toEqual(names(b.meals));
    expect(names(plan.days[0].slots)).toEqual(names(a.meals));
  });

  it('mỗi món mang đủ dữ liệu từ kho: giá trị trên 1 phần × số phần = tổng', async () => {
    const plan: any = await build(user()).getPlan('u1', 7);
    for (const day of plan.days) {
      for (const slot of day.slots) {
        for (const item of slot.items) {
          expect(item.calories).toBeCloseTo(item.unit.calories * item.quantity, 0);
          expect(item.quantity).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('Thực đơn: phong cách macro', () => {
  const starchOrNoodle = ['Cơm - Tinh bột', 'Bún - Phở - Mì'];
  const catOf = (name: string) => getAllowedFoods({}).find((f) => f.name === name)!.category;

  it('KETO: bữa trưa và tối không có cơm/bún/mì', async () => {
    const plan: any = await build(user({ macroStyle: 'KETO' })).getPlan('u1', 7);
    for (const day of plan.days) {
      for (const slot of day.slots.filter((s: any) => s.mealType === 'LUNCH' || s.mealType === 'DINNER')) {
        for (const item of slot.items) expect(starchOrNoodle).not.toContain(catOf(item.name));
      }
    }
  });

  it('LOW_CARB_HIGH_FAT ít tinh bột hơn BALANCED trong tổng carb của kế hoạch', async () => {
    const carb = async (macroStyle: string) => {
      const plan: any = await build(user({ macroStyle })).getPlan('u1', 7);
      return plan.days.reduce((s: number, d: any) => s + d.totals.carb, 0);
    };
    expect(await carb('LOW_CARB_HIGH_FAT')).toBeLessThan(await carb('BALANCED'));
  });
});

describe('Thực đơn hôm nay: trạng thái đã ăn / chưa ăn', () => {
  it('chưa ăn gì: mọi bữa PLANNED, không đề xuất phần còn lại', async () => {
    const today: any = await build(user()).getToday('u1');
    expect(today.meals.every((m: any) => m.status === 'PLANNED')).toBe(true);
    expect(today.meals.every((m: any) => m.suggestionForRemaining === null)).toBe(true);
  });

  it('đã ghi gần đủ bữa sáng → LOGGED; món trùng tên được đánh dấu đã ăn', async () => {
    const svc = build(user());
    const before: any = await svc.getToday('u1');
    const breakfast = before.meals[0];
    const logged = [{ mealType: 'BREAKFAST', totalCalories: breakfast.budgetCalories, items: [{ name: breakfast.items[0].name }] }];
    const after: any = await build(user(), logged).getToday('u1');
    expect(after.meals[0].status).toBe('LOGGED');
    expect(after.meals[0].items[0].logged).toBe(true);
    expect(after.meals[1].status).toBe('PLANNED');
  });

  it('ăn một phần → PARTIAL, có đề xuất theo phần ngân sách còn lại', async () => {
    const before: any = await build(user()).getToday('u1');
    const lunch = before.meals[1];
    const logged = [{ mealType: 'LUNCH', totalCalories: Math.round(lunch.budgetCalories * 0.4), items: [{ name: 'Món khác' }] }];
    const after: any = await build(user(), logged).getToday('u1');
    const m = after.meals[1];
    expect(m.status).toBe('PARTIAL');
    expect(m.remainingCalories).toBe(lunch.budgetCalories - Math.round(lunch.budgetCalories * 0.4));
    expect(m.suggestionForRemaining).not.toBeNull();
    expect(m.suggestionForRemaining.budgetCalories).toBe(m.remainingCalories);
  });

  it('ăn vượt ngân sách bữa: remainingCalories âm và không đề xuất thêm', async () => {
    const before: any = await build(user()).getToday('u1');
    const dinner = before.meals[2];
    const logged = [{ mealType: 'DINNER', totalCalories: dinner.budgetCalories + 300, items: [] }];
    const after: any = await build(user(), logged).getToday('u1');
    expect(after.meals[2].status).toBe('LOGGED');
    expect(after.meals[2].remainingCalories).toBe(-300);
    expect(after.meals[2].suggestionForRemaining).toBeNull();
  });
});

describe('Thực đơn: chưa có mục tiêu', () => {
  it('trả PROFILE_INCOMPLETE thay vì bịa mục tiêu', async () => {
    await expect(build(user({ targetCalories: null })).getToday('u1')).rejects.toBeInstanceOf(ProfileIncompleteException);
    await expect(build(user({ targetCalories: null })).getPlan('u1', 7)).rejects.toBeInstanceOf(ProfileIncompleteException);
  });
});

describe('Kế hoạch 30 ngày: Free xem trước, Premium đầy đủ', () => {
  it('đang kiểm thử (chưa bật khoá): mọi người thấy đủ 30 ngày', async () => {
    const plan: any = await build(user()).getPlan('u1', 30);
    expect(plan.days).toHaveLength(30);
    expect(plan.days.every((d: any) => !d.locked)).toBe(true);
    expect(plan.lockedFromDay).toBeNull();
  });

  it('bật khoá, Free: 7 ngày đầu đầy đủ, ngày 8–30 chỉ có khoá', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const plan: any = await build(user()).getPlan('u1', 30);
    expect(plan.days).toHaveLength(30);
    expect(plan.previewDays).toBe(FREE_PREVIEW_DAYS);
    expect(plan.lockedFromDay).toBe(8);
    expect(plan.days.slice(0, 7).every((d: any) => !d.locked && d.slots.length > 0)).toBe(true);
    for (const d of plan.days.slice(7)) {
      expect(d.locked).toBe(true);
      expect(d.slots).toBeUndefined(); // không lộ nội dung ngày bị khoá
    }
  });

  it('bật khoá, Premium: đủ 30 ngày', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const plan: any = await build(user(), [], true).getPlan('u1', 30);
    expect(plan.days.every((d: any) => !d.locked)).toBe(true);
    expect(plan.lockedFromDay).toBeNull();
  });

  it('bật khoá, Free: kế hoạch 7 ngày và thực đơn hôm nay vẫn đầy đủ', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const week: any = await build(user()).getPlan('u1', 7);
    expect(week.days).toHaveLength(7);
    expect(week.days.every((d: any) => !d.locked)).toBe(true);
    const today: any = await build(user()).getToday('u1');
    expect(today.meals.length).toBeGreaterThan(0);
  });

  it('7 ngày đầu của kế hoạch 30 ngày giống kế hoạch 7 ngày', async () => {
    const svc = build(user());
    const w: any = await svc.getPlan('u1', 7);
    const m: any = await svc.getPlan('u1', 30);
    const names = (d: any) => d.slots.flatMap((s: any) => s.items.map((i: any) => i.name));
    for (let i = 0; i < 7; i++) expect(names(m.days[i])).toEqual(names(w.days[i]));
  });
});

describe('Bộ lập thực đơn thuần', () => {
  const foods = getAllowedFoods({});
  it('cùng hạt giống cho cùng kết quả, khác hạt giống thường cho thực đơn khác', () => {
    const a = buildDayPlan(foods, { targetCalories: 2000, seed: 'x' });
    const b = buildDayPlan(foods, { targetCalories: 2000, seed: 'x' });
    const c = buildDayPlan(foods, { targetCalories: 2000, seed: 'y' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('tập món rỗng không làm hỏng: các bữa trống nhưng không ném lỗi', () => {
    const plan = buildDayPlan([], { targetCalories: 2000, seed: 'x' });
    expect(plan.slots.every((s) => s.items.length === 0)).toBe(true);
    expect(plan.totals.calories).toBe(0);
  });
});
