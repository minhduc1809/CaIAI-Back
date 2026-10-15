import { AiService } from './ai.service';
import { parseDetectedDishes, parseEstimates } from './vision-schema';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';

/** Bộ đếm UsageCounter giả trong bộ nhớ, như feature-quota.spec. */
function build() {
  const row: Record<string, number> = { aiPhoto: 0, chatTokens: 0, chatMessages: 0, menuScans: 0, suggestMeals: 0, barcodeLookups: 0 };
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', purchasedAiQuota: 0, purchasedChatQuota: 0 })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    usageCounter: {
      upsert: jest.fn(async () => ({})),
      findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async ({ data }: any) => {
        for (const [k, v] of Object.entries<any>(data)) row[k] += v.increment;
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const col = Object.keys(data)[0];
        const cond = where[col];
        if (cond.lt !== undefined && !(row[col] < cond.lt)) return { count: 0 };
        if (cond.gt !== undefined && !(row[col] > cond.gt)) return { count: 0 };
        row[col] += data[col].increment ?? -data[col].decrement;
        return { count: 1 };
      }),
    },
    subscriptionState: { findUnique: jest.fn(async () => null) },
    manualGrant: { findFirst: jest.fn(async () => null) },
    apiUsageLog: { create: jest.fn(async () => ({})) },
  };
  const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
  return { svc, row };
}

/** Gemini giả: trả lần lượt các chuỗi đã định; vượt quá thì lặp lại chuỗi cuối. */
function fakeGemini(svc: any, replies: (string | Error)[]) {
  const generateContent = jest.fn(async () => {
    const next = replies[Math.min(generateContent.mock.calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return { response: { text: () => next } };
  });
  svc.genAI = { getGenerativeModel: () => ({ generateContent }) };
  return generateContent;
}

const dish = (over: any = {}) => ({
  dishName: 'Phở bò',
  possibleNames: [],
  portion: { amount: 1, unit: 'tô' },
  confidence: 0.9,
  ...over,
});
const vision = (items: any[], extra: any = {}) => JSON.stringify({ isFood: true, items, healthTip: 'Ăn thêm rau.', ...extra });
const estimate = (list: any[]) => JSON.stringify({ estimates: list });

const run = (svc: any) => svc.analyzeFoodImageBase64('aGVsbG8=', 'image/jpeg', 'u1');
const rejection = async (p: Promise<unknown>): Promise<any> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('Lẽ ra phải ném lỗi');
};
const catalog = (name: string) => VIETNAMESE_FOODS_DATA.find((f) => f.name === name)!;

describe('G1 / BR-11.1: nhận diện ảnh neo vào kho món', () => {
  it('AC2: "phở bò" khớp kho → AI_MATCHED, calo đúng số liệu kho (không phải số Gemini bịa)', async () => {
    const { svc } = build();
    // Gemini lỡ kèm calo bịa: phải bị bỏ qua
    const g = fakeGemini(svc, [vision([dish({ calories: 9999, totalCalories: 9999 })])]);
    const res = await run(svc);
    const pho = catalog('Phở bò tái nạc');

    expect(g).toHaveBeenCalledTimes(1); // khớp kho nên không cần gọi ước tính
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      name: 'Phở bò tái nạc',
      sourceType: 'AI_MATCHED',
      isEstimate: false,
      calories: Math.round(pho.calories),
      confidenceLevel: 'HIGH',
    });
    expect(res.totalCalories).toBe(Math.round(pho.calories));
    expect(res.isFallback).toBe(false);
    expect(res.items[0].sourceId).toBe('pho-bo-tai-nac');
  });

  it('trả kèm tối đa 3 món gần nhất để đổi, không gồm món đã chọn', async () => {
    const { svc } = build();
    fakeGemini(svc, [vision([dish()])]);
    const res = await run(svc);
    const alts = res.items[0].alternatives;
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.length).toBeLessThanOrEqual(3);
    expect(alts.map((a: any) => a.name)).not.toContain('Phở bò tái nạc');
    expect(alts[0]).toEqual(expect.objectContaining({ sourceId: expect.any(String), calories: expect.any(Number) }));
  });

  it('nhân theo khẩu phần: 2 tô = gấp đôi; 260g cơm = 2 chén (130g)', async () => {
    const { svc } = build();
    fakeGemini(svc, [vision([dish({ portion: { amount: 2, unit: 'tô' } })])]);
    let res = await run(svc);
    expect(res.items[0].calories).toBe(Math.round(catalog('Phở bò tái nạc').calories * 2));

    const b = build();
    fakeGemini(b.svc, [vision([dish({ dishName: 'Cơm trắng', portion: { amount: 260, unit: 'g' } })])]);
    res = await run(b.svc);
    expect(res.items[0].calories).toBe(Math.round(catalog('Cơm trắng').calories * 2));
    expect(res.items[0].servingSize).toBe('260 g');
  });

  it('nhiều món trong một ảnh: tổng đúng bằng tổng từng món', async () => {
    const { svc } = build();
    fakeGemini(svc, [vision([dish(), dish({ dishName: 'Chuối', portion: { amount: 1, unit: 'quả' } })])]);
    const res = await run(svc);
    expect(res.items).toHaveLength(2);
    const sum = res.items.reduce((a: number, i: any) => a + i.calories, 0);
    expect(res.totalCalories).toBe(sum);
    expect(res.foodName).toBe('Phở bò tái nạc + Chuối tiêu chín');
    expect(res.servingSize).toBe('2 món');
  });

  it('món không có trong kho → AI_ESTIMATE, nhãn Ước tính, độ tin cậy thấp', async () => {
    const { svc } = build();
    const g = fakeGemini(svc, [
      vision([dish({ dishName: 'Bánh xèo', portion: { amount: 1, unit: 'cái' }, confidence: 0.95 })]),
      estimate([{ dishName: 'Bánh xèo', calories: 400, protein: 15, carb: 40, fat: 20 }]),
    ]);
    const res = await run(svc);
    expect(g).toHaveBeenCalledTimes(2);
    expect(res.items[0]).toMatchObject({
      name: 'Bánh xèo',
      sourceType: 'AI_ESTIMATE',
      isEstimate: true,
      confidenceLevel: 'LOW',
      atwaterAdjusted: false,
    });
    expect(res.items[0].sourceId).toBeUndefined();
    expect(res.items[0].confidence).toBeLessThanOrEqual(0.5);
    expect(res.confidenceScore).toBeLessThanOrEqual(0.5);
  });

  it('Atwater: calo ước tính lệch > 15% so với 4P+4C+9F thì sửa theo macro và gắn cờ', async () => {
    const { svc } = build();
    fakeGemini(svc, [
      vision([dish({ dishName: 'Bánh xèo' })]),
      estimate([{ dishName: 'Bánh xèo', calories: 900, protein: 10, carb: 20, fat: 10 }]),
    ]);
    const res = await run(svc);
    expect(res.items[0].calories).toBe(210);
    expect(res.items[0].atwaterAdjusted).toBe(true);
  });

  it('ảnh có cả món trong kho lẫn ngoài kho: món trong kho vẫn dùng số liệu kho', async () => {
    const { svc } = build();
    fakeGemini(svc, [
      vision([dish(), dish({ dishName: 'Bánh xèo' })]),
      estimate([{ dishName: 'Bánh xèo', calories: 400, protein: 15, carb: 40, fat: 20 }]),
    ]);
    const res = await run(svc);
    expect(res.items.map((i: any) => i.sourceType)).toEqual(['AI_MATCHED', 'AI_ESTIMATE']);
  });

  it('ước tính món ngoài kho thất bại: vẫn trả món khớp kho, liệt kê món chưa ước tính được', async () => {
    const { svc, row } = build();
    fakeGemini(svc, [vision([dish(), dish({ dishName: 'Bánh xèo' })]), 'không phải json']);
    const res = await run(svc);
    expect(res.items).toHaveLength(1);
    expect(res.unrecognized).toEqual(['Bánh xèo']);
    expect(row.aiPhoto).toBe(1); // có kết quả nên tính lượt
  });

  it('chỉ có món ngoài kho và ước tính thất bại: 503 AI_UNAVAILABLE và hoàn lượt', async () => {
    const { svc, row } = build();
    fakeGemini(svc, [vision([dish({ dishName: 'Bánh xèo' })]), 'không phải json']);
    const err = await rejection(run(svc));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse().code).toBe('AI_UNAVAILABLE');
    expect(row.aiPhoto).toBe(0);
  });

  it('JSON sai schema ở lần đầu → thử lại một lần và thành công', async () => {
    const { svc } = build();
    const g = fakeGemini(svc, [JSON.stringify({ isFood: true, items: [{ dishName: 'Phở bò' }] }), vision([dish()])]);
    const res = await run(svc);
    expect(g).toHaveBeenCalledTimes(2);
    expect(res.items[0].sourceType).toBe('AI_MATCHED');
  });

  it('sai schema cả hai lần → 502 AI_BAD_RESPONSE và hoàn lượt', async () => {
    const { svc, row } = build();
    const g = fakeGemini(svc, ['{"isFood":true,"items":[]}']);
    const err = await rejection(run(svc));
    expect(g).toHaveBeenCalledTimes(2);
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse().code).toBe('AI_BAD_RESPONSE');
    expect(row.aiPhoto).toBe(0);
  });

  it('không phải đồ ăn → 400 NOT_FOOD, không thử lại, hoàn lượt', async () => {
    const { svc, row } = build();
    const g = fakeGemini(svc, [JSON.stringify({ isFood: false, message: 'Không thấy món ăn' })]);
    const err = await rejection(run(svc));
    expect(g).toHaveBeenCalledTimes(1);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().code).toBe('NOT_FOOD');
    expect(row.aiPhoto).toBe(0);
  });

  it('Gemini lỗi mạng → 503 AI_UNAVAILABLE và hoàn lượt', async () => {
    const { svc, row } = build();
    fakeGemini(svc, [new Error('fetch failed')]);
    const err = await rejection(run(svc));
    expect(err.getStatus()).toBe(503);
    expect(row.aiPhoto).toBe(0);
  });

  it('thành công thì trừ đúng một lượt', async () => {
    const { svc, row } = build();
    fakeGemini(svc, [vision([dish()])]);
    await run(svc);
    expect(row.aiPhoto).toBe(1);
  });
});

describe('Kiểm tra schema JSON từ Gemini', () => {
  const ok = { isFood: true, items: [dish()] };

  it('chấp nhận dữ liệu hợp lệ và chuẩn hoá', () => {
    const r = parseDetectedDishes({ ...ok, items: [dish({ dishName: '  Phở bò ', confidence: 1.7 })] });
    expect(r![0].dishName).toBe('Phở bò');
    expect(r![0].confidence).toBe(1);
  });

  it.each([
    ['null', null],
    ['isFood không phải true', { ...ok, isFood: 'true' }],
    ['items không phải mảng', { isFood: true, items: 'phở' }],
    ['items rỗng', { isFood: true, items: [] }],
    ['quá 8 món', { isFood: true, items: Array.from({ length: 9 }, () => dish()) }],
    ['thiếu tên món', { isFood: true, items: [dish({ dishName: ' ' })] }],
    ['khẩu phần âm', { isFood: true, items: [dish({ portion: { amount: -1, unit: 'tô' } })] }],
    ['khẩu phần thiếu đơn vị', { isFood: true, items: [dish({ portion: { amount: 1 } })] }],
    ['confidence là chuỗi', { isFood: true, items: [dish({ confidence: 'cao' })] }],
  ])('từ chối: %s', (_name, input) => {
    expect(parseDetectedDishes(input)).toBeNull();
  });

  it('ước tính: hợp lệ thì trả đúng thứ tự món', () => {
    const r = parseEstimates(
      { estimates: [{ dishName: 'B', calories: 100, protein: 1, carb: 1, fat: 1 }, { dishName: 'A', calories: 200, protein: 2, carb: 2, fat: 2 }] },
      ['A', 'B'],
    );
    expect(r!.map((e) => e.dishName)).toEqual(['A', 'B']);
  });

  it.each([
    ['thiếu món', { estimates: [{ dishName: 'A', calories: 100, protein: 1, carb: 1, fat: 1 }] }],
    ['calo âm', { estimates: [{ dishName: 'A', calories: -5, protein: 1, carb: 1, fat: 1 }, { dishName: 'B', calories: 1, protein: 1, carb: 1, fat: 1 }] }],
    ['calo vô lý', { estimates: [{ dishName: 'A', calories: 90000, protein: 1, carb: 1, fat: 1 }, { dishName: 'B', calories: 1, protein: 1, carb: 1, fat: 1 }] }],
    ['macro là chuỗi', { estimates: [{ dishName: 'A', calories: 100, protein: '1', carb: 1, fat: 1 }, { dishName: 'B', calories: 1, protein: 1, carb: 1, fat: 1 }] }],
    ['không có estimates', {}],
  ])('ước tính từ chối: %s', (_n, input) => {
    expect(parseEstimates(input, ['A', 'B'])).toBeNull();
  });
});
