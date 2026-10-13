import { AiService } from './ai.service';
import { parseMenu, rankMenuItems } from './menu-schema';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';

const catalog = (name: string) => VIETNAMESE_FOODS_DATA.find((f) => f.name === name)!;

function build(opts: {
  rules?: { dietType?: string; allergies?: string[] };
  targetCalories?: number | null;
  targetProtein?: number;
  consumed?: number;
  consumedProtein?: number;
}) {
  const row: Record<string, number> = { menuScans: 0, aiPhoto: 0, chatMessages: 0, chatTokens: 0, suggestMeals: 0, barcodeLookups: 0 };
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({
        timezone: 'Asia/Ho_Chi_Minh',
        purchasedAiQuota: 0,
        dietType: 'OMNIVORE',
        allergies: [],
        ...opts.rules,
        goal: 'MAINTAIN',
        targetCalories: opts.targetCalories === undefined ? 2000 : opts.targetCalories,
        targetProtein: opts.targetProtein ?? 120,
      })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    subscriptionState: { findUnique: jest.fn(async () => null) },
    manualGrant: { findFirst: jest.fn(async () => null) },
    usageCounter: {
      upsert: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async () => ({ ...row })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const col = Object.keys(data)[0];
        const cond = where[col];
        if (cond?.lt !== undefined && !(row[col] < cond.lt)) return { count: 0 };
        if (cond?.gt !== undefined && !(row[col] > cond.gt)) return { count: 0 };
        row[col] += data[col].increment ?? -data[col].decrement;
        return { count: 1 };
      }),
    },
    meal: {
      findMany: jest.fn(async () =>
        opts.consumed ? [{ totalCalories: opts.consumed, totalProtein: opts.consumedProtein ?? 0 }] : [],
      ),
    },
    apiUsageLog: { create: jest.fn(async () => ({})) },
  };
  const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
  return { svc, row };
}

/** Gemini giả: trả lần lượt các chuỗi (lần cuối lặp lại). */
function fakeGemini(svc: any, replies: (string | Error)[]) {
  const generateContent = jest.fn(async () => {
    const next = replies[Math.min(generateContent.mock.calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return { response: { text: () => next } };
  });
  svc.genAI = { getGenerativeModel: () => ({ generateContent }) };
  return generateContent;
}

const menuJson = (items: any[], extra: any = {}) => JSON.stringify({ isMenu: true, restaurantName: 'Quán A', items, ...extra });
const estimateJson = (list: any[]) => JSON.stringify({ estimates: list });
const scan = (svc: any) => svc.scanMenuBase64('aGVsbG8=', 'image/jpeg', 'u1');
const rejection = async (p: Promise<unknown>): Promise<any> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('Lẽ ra phải ném lỗi');
};

describe('G3 / BR-11.3: quét thực đơn neo vào kho món', () => {
  it('món có trong kho: số liệu lấy từ kho (không phải số Gemini), nhãn AI_MATCHED', async () => {
    const { svc } = build({});
    // Gemini lỡ kèm calo bịa: phải bị bỏ qua
    fakeGemini(svc, [menuJson([{ name: 'Phở bò', price: '55,000', description: 'Bánh phở, thịt bò', estimatedCalories: 9999 }])]);
    const res = await scan(svc);
    const pho = catalog('Phở bò tái nạc');
    expect(res.items[0]).toMatchObject({
      name: 'Phở bò',
      price: '55,000',
      estimatedCalories: Math.round(pho.calories),
      sourceType: 'AI_MATCHED',
      isEstimate: false,
      servingSize: pho.servingSize,
    });
    expect(res.items[0].sourceId).toBe('pho-bo-tai-nac');
  });

  it('món ngoài kho: AI ước tính một lần cho cả nhóm, gắn nhãn Ước tính, kiểm tra Atwater', async () => {
    const { svc } = build({});
    const g = fakeGemini(svc, [
      menuJson([{ name: 'Phở bò' }, { name: 'Bánh xèo' }, { name: 'Mì Quảng' }]),
      estimateJson([
        { dishName: 'Bánh xèo', calories: 400, protein: 15, carb: 40, fat: 20 },
        { dishName: 'Mì Quảng', calories: 900, protein: 10, carb: 20, fat: 10 }, // lệch Atwater → sửa còn 210
      ]),
    ]);
    const res = await scan(svc);
    expect(g).toHaveBeenCalledTimes(2); // 1 lần đọc menu + 1 lần ước tính cho cả nhóm
    const by = Object.fromEntries(res.items.map((i: any) => [i.name, i]));
    expect(by['Bánh xèo']).toMatchObject({ sourceType: 'AI_ESTIMATE', isEstimate: true, estimatedCalories: 400 });
    expect(by['Mì Quảng'].estimatedCalories).toBe(210);
    expect(by['Phở bò'].sourceType).toBe('AI_MATCHED');
  });

  it('ước tính thất bại: món vẫn được liệt kê nhưng không có số liệu và không được đề xuất', async () => {
    const { svc } = build({});
    fakeGemini(svc, [menuJson([{ name: 'Phở bò' }, { name: 'Bánh xèo' }]), 'không phải json']);
    const res = await scan(svc);
    const xeo = res.items.find((i: any) => i.name === 'Bánh xèo');
    expect(xeo.nutritionAvailable).toBe(false);
    expect(xeo.estimatedCalories).toBe(0);
    expect(xeo.isRecommended).toBe(false);
    expect(res.recommendedItems.map((i: any) => i.name)).not.toContain('Bánh xèo');
  });

  it('chỉ đề xuất tối đa 3 món, vừa với phần calo còn lại', async () => {
    const { svc } = build({ consumed: 1500 }); // còn 500 kcal
    fakeGemini(svc, [
      menuJson([
        { name: 'Phở bò' },
        { name: 'Cơm trắng' },
        { name: 'Chuối' },
        { name: 'Trứng luộc' },
        { name: 'Táo' },
        { name: 'Bún bò Huế' },
      ]),
    ]);
    const res = await scan(svc);
    expect(res.recommendedItems.length).toBeLessThanOrEqual(3);
    expect(res.recommendedItems.length).toBeGreaterThan(0);
    for (const r of res.recommendedItems) {
      expect(r.estimatedCalories).toBeLessThanOrEqual(500 * 1.1);
      expect(r.isRecommended).toBe(true);
      expect(r.recommendationReason).toMatch(/kcal/);
    }
    expect(res.items.filter((i: any) => i.isRecommended)).toHaveLength(res.recommendedItems.length);
  });

  it('lọc cứng: món có thịt không bao giờ được đề xuất cho người ăn chay, kể cả khi vừa calo nhất', async () => {
    const { svc } = build({ rules: { dietType: 'VEGAN', allergies: [] } });
    fakeGemini(svc, [menuJson([{ name: 'Phở bò' }, { name: 'Đậu phụ sốt cà' }, { name: 'Chuối' }])]);
    const res = await scan(svc);
    const pho = res.items.find((i: any) => i.name === 'Phở bò');
    expect(pho.warning).toBeDefined();
    expect(pho.isRecommended).toBe(false);
    expect(res.recommendedItems.map((i: any) => i.name)).not.toContain('Phở bò');
  });

  it('dị ứng: món khớp kho nhưng chứa chất dị ứng bị cảnh báo dù tên món không nhắc tới chất đó', async () => {
    const { svc } = build({ rules: { dietType: 'OMNIVORE', allergies: ['EGG'] } });
    fakeGemini(svc, [menuJson([{ name: 'Trứng luộc' }, { name: 'Cơm trắng' }])]);
    const res = await scan(svc);
    expect(res.items.find((i: any) => i.name === 'Trứng luộc').warning).toBeDefined();
    expect(res.items.find((i: any) => i.name === 'Cơm trắng').warning).toBeUndefined();
    expect(res.recommendedItems.map((i: any) => i.name)).not.toContain('Trứng luộc');
  });

  it('đã đạt mục tiêu calo: không đề xuất món nào, lời khuyên nêu món nhẹ nhất', async () => {
    const { svc } = build({ consumed: 2200 });
    fakeGemini(svc, [menuJson([{ name: 'Phở bò' }, { name: 'Chuối' }])]);
    const res = await scan(svc);
    expect(res.recommendedItems).toEqual([]);
    expect(res.summaryAdvice).toMatch(/đã đạt mục tiêu/);
    expect(res.summaryAdvice).toMatch(/Chuối/);
  });

  it('luôn kèm cảnh báo chung về thành phần tuỳ cách chế biến', async () => {
    const { svc } = build({});
    fakeGemini(svc, [menuJson([{ name: 'Phở bò' }])]);
    const res = await scan(svc);
    expect(res.disclaimer).toMatch(/tuỳ cách chế biến của quán/);
  });

  it('thực đơn dài hơn 30 món: lấy 30 món đầu, không báo lỗi', async () => {
    const { svc } = build({});
    fakeGemini(svc, [menuJson(Array.from({ length: 45 }, (_, i) => ({ name: `Món số ${i + 1}` }))), estimateJson([])]);
    const res = await scan(svc);
    expect(res.items).toHaveLength(30);
  });

  it('không phải thực đơn → 400 NOT_MENU, hoàn lượt, không thử lại', async () => {
    const { svc, row } = build({});
    const g = fakeGemini(svc, [JSON.stringify({ isMenu: false, message: 'Không thấy thực đơn' })]);
    const err = await rejection(scan(svc));
    expect(g).toHaveBeenCalledTimes(1);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().code).toBe('NOT_MENU');
    expect(row.menuScans).toBe(0);
  });

  it('JSON sai schema lần đầu → thử lại một lần và thành công', async () => {
    const { svc } = build({});
    const g = fakeGemini(svc, [JSON.stringify({ isMenu: true, items: 'không phải mảng' }), menuJson([{ name: 'Phở bò' }])]);
    const res = await scan(svc);
    expect(g).toHaveBeenCalledTimes(2);
    expect(res.items).toHaveLength(1);
  });

  it('sai schema cả hai lần → 502 AI_BAD_RESPONSE và hoàn lượt', async () => {
    const { svc, row } = build({});
    fakeGemini(svc, ['{"isMenu":true,"items":[]}']);
    const err = await rejection(scan(svc));
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse().code).toBe('AI_BAD_RESPONSE');
    expect(row.menuScans).toBe(0);
  });

  it('AI lỗi mạng → 503 AI_UNAVAILABLE và hoàn lượt; thiếu key cũng vậy', async () => {
    const a = build({});
    fakeGemini(a.svc, [new Error('fetch failed')]);
    const err = await rejection(scan(a.svc));
    expect(err.getStatus()).toBe(503);
    expect(a.row.menuScans).toBe(0);

    const b = build({});
    const err2 = await rejection(scan(b.svc));
    expect(err2.getResponse().code).toBe('AI_UNAVAILABLE');
    expect(b.row.menuScans).toBe(0);
  });

  it('chưa có mục tiêu calo → PROFILE_INCOMPLETE, hoàn lượt', async () => {
    const { svc, row } = build({ targetCalories: null });
    fakeGemini(svc, [menuJson([{ name: 'Phở bò' }])]);
    const err = await rejection(scan(svc));
    expect(err.getResponse().code).toBe('PROFILE_INCOMPLETE');
    expect(row.menuScans).toBe(0);
  });
});

describe('Kiểm tra schema thực đơn và xếp hạng', () => {
  it('parseMenu bỏ món không tên, cắt tên quá dài, từ chối khi không còn món nào', () => {
    const ok = parseMenu({ isMenu: true, items: [{ name: ' Phở ' }, { name: '' }, { price: '1' }, null] });
    expect(ok!.items.map((i) => i.name)).toEqual(['Phở']);
    expect(parseMenu({ isMenu: true, items: [{ name: '' }] })).toBeNull();
    expect(parseMenu({ isMenu: true, items: 'x' })).toBeNull();
    expect(parseMenu({ isMenu: false, items: [{ name: 'a' }] })).toBeNull();
    expect(parseMenu(null)).toBeNull();
  });

  it('rankMenuItems: loại món vượt 110% calo còn lại, ưu tiên món gần phần còn lại và đủ đạm', () => {
    const items = [
      { index: 0, calories: 300, protein: 10 },
      { index: 1, calories: 480, protein: 35 },
      { index: 2, calories: 700, protein: 40 }, // vượt 500 × 1,1
      { index: 3, calories: 0, protein: 0 }, // không có số liệu
    ];
    expect(rankMenuItems(items, 500, 35, 3)).toEqual([1, 0]);
    expect(rankMenuItems(items, 500, 35, 1)).toEqual([1]);
  });

  it('rankMenuItems: hết calo hoặc max = 0 thì không đề xuất', () => {
    expect(rankMenuItems([{ index: 0, calories: 100, protein: 5 }], 0, 0)).toEqual([]);
    expect(rankMenuItems([{ index: 0, calories: 100, protein: 5 }], 500, 20, 0)).toEqual([]);
  });
});
