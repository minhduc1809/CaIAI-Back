import { AiService } from './ai.service';
import { computeCostUsd, percentile, summarizeUserCosts, trackModel, withAiUsage } from './ai-usage';

describe('Chi phí AI theo bảng giá (BR-15.5)', () => {
  it('tính theo giá mỗi triệu token của đầu vào và đầu ra', () => {
    const env = { AI_PRICE_INPUT_USD_PER_MTOK: '0.1', AI_PRICE_OUTPUT_USD_PER_MTOK: '0.4' } as any;
    expect(computeCostUsd(1_000_000, 0, env)).toBeCloseTo(0.1, 8);
    expect(computeCostUsd(0, 1_000_000, env)).toBeCloseTo(0.4, 8);
    expect(computeCostUsd(2000, 500, env)).toBeCloseTo((2000 * 0.1 + 500 * 0.4) / 1e6, 8);
  });

  it('thiếu hoặc sai biến môi trường thì dùng mặc định (mức cao), không ra NaN', () => {
    expect(computeCostUsd(1_000_000, 1_000_000, {} as any)).toBeCloseTo(0.3 + 2.5, 6);
    expect(
      computeCostUsd(1000, 1000, { AI_PRICE_INPUT_USD_PER_MTOK: 'abc', AI_PRICE_OUTPUT_USD_PER_MTOK: '-1' } as any),
    ).toBeCloseTo((1000 * 0.3 + 1000 * 2.5) / 1e6, 8);
  });

  it('0 token thì 0 đồng', () => {
    expect(computeCostUsd(0, 0, {} as any)).toBe(0);
  });
});

describe('Phân vị chi phí người dùng (p50 / p75 / p95)', () => {
  it('nearest-rank đúng với ví dụ nhỏ', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 50)).toBe(7);
  });

  it('không phụ thuộc thứ tự đầu vào và không làm đổi mảng gốc', () => {
    const input = [5, 1, 4, 2, 3];
    expect(percentile(input, 50)).toBe(3);
    expect(input).toEqual([5, 1, 4, 2, 3]);
  });

  it('tóm tắt 100 người dùng: nhóm nặng p95 lớn hơn nhóm nhẹ p50', () => {
    const costs = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
    const s = summarizeUserCosts(costs);
    expect(s).toMatchObject({ users: 100, p50: 0.5, p75: 0.75, p95: 0.95, max: 1 });
    expect(s.avgCostUsd).toBeCloseTo(0.505, 6);
    expect(summarizeUserCosts([])).toEqual({ users: 0, avgCostUsd: 0, p50: 0, p75: 0, p95: 0, max: 0 });
  });
});

describe('Ghi log lời gọi Gemini thật', () => {
  const make = (impl: () => Promise<any>) => {
    const logs: any[] = [];
    const prisma: any = { apiUsageLog: { create: jest.fn(async ({ data }: any) => logs.push(data)) } };
    const model = trackModel(prisma, { generateContent: async (_content: any) => impl() }, 'gemini-test');
    return { model, logs, prisma };
  };

  it('ghi token thật từ usageMetadata, model, độ trễ, trạng thái OK và gán đúng người dùng/tính năng', async () => {
    const { model, logs } = make(async () => ({
      response: { text: () => 'x', usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 321 } },
    }));
    await withAiUsage('u1', 'chat_coach', () => model.generateContent('lời nhắc bí mật'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: 'u1',
      feature: 'chat_coach',
      model: 'gemini-test',
      promptTokens: 1234,
      outputTokens: 321,
      status: 'OK',
    });
    expect(logs[0].costUsd).toBeCloseTo(computeCostUsd(1234, 321), 8);
    expect(typeof logs[0].latencyMs).toBe('number');
  });

  it('KHÔNG bao giờ ghi nội dung lời nhắc hay ảnh vào log', async () => {
    const { model, logs } = make(async () => ({
      response: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    }));
    await withAiUsage('u1', 'menu_scan', () =>
      model.generateContent(['lời nhắc bí mật', { inlineData: { data: 'AAAA' } }]),
    );
    expect(JSON.stringify(logs)).not.toMatch(/bí mật|AAAA/);
  });

  it('Gemini không trả usageMetadata: ghi 0 token và đánh dấu OK_NO_USAGE để báo cáo loại ra', async () => {
    const { model, logs } = make(async () => ({ response: { text: () => 'x' } }));
    await withAiUsage('u1', 'suggest_meal', () => model.generateContent('p'));
    expect(logs[0]).toMatchObject({ promptTokens: 0, outputTokens: 0, status: 'OK_NO_USAGE' });
  });

  it('lời gọi lỗi: ghi trạng thái ERROR rồi ném lại đúng lỗi gốc', async () => {
    const { model, logs } = make(async () => {
      throw new Error('503 upstream');
    });
    await expect(withAiUsage('u1', 'chat_coach', () => model.generateContent('p'))).rejects.toThrow('503 upstream');
    expect(logs[0]).toMatchObject({ status: 'ERROR', costUsd: 0 });
  });

  it('không có ngữ cảnh người dùng thì không ghi (không biết của ai) nhưng lời gọi vẫn chạy', async () => {
    const { model, logs } = make(async () => ({
      response: { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } },
    }));
    const res = await model.generateContent('p');
    expect(res.response.usageMetadata.promptTokenCount).toBe(5);
    expect(logs).toHaveLength(0);
  });

  it('lỗi khi ghi log không làm hỏng lời gọi AI', async () => {
    const prisma: any = {
      apiUsageLog: {
        create: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const model = trackModel(
      prisma,
      { generateContent: async (_content: any) => ({ response: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }) },
      'm',
    );
    await expect(withAiUsage('u1', 'chat_coach', () => model.generateContent('p'))).resolves.toBeDefined();
  });

  it('hai người dùng chạy đồng thời không lẫn ngữ cảnh', async () => {
    const { model, logs } = make(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { response: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } };
    });
    await Promise.all([
      withAiUsage('A', 'chat_coach', () => model.generateContent('p')),
      withAiUsage('B', 'menu_scan', () => model.generateContent('p')),
    ]);
    expect(logs.map((l) => `${l.userId}:${l.feature}`).sort()).toEqual(['A:chat_coach', 'B:menu_scan']);
  });
});

describe('AiService: mọi lời gọi Gemini được gán đúng người dùng và tính năng', () => {
  it('nhận diện ảnh gồm lần đọc ảnh và lần ước tính: cùng tính năng food_recognition, token thật', async () => {
    const logs: any[] = [];
    const row: Record<string, number> = {
      aiPhoto: 0,
      chatTokens: 0,
      chatMessages: 0,
      menuScans: 0,
      suggestMeals: 0,
      barcodeLookups: 0,
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', purchasedAiQuota: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      usageCounter: {
        upsert: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ data }: any) => {
          const col = Object.keys(data)[0];
          row[col] += data[col].increment ?? -data[col].decrement;
          return { count: 1 };
        }),
      },
      subscriptionState: { findUnique: jest.fn(async () => null) },
      manualGrant: { findFirst: jest.fn(async () => null) },
      apiUsageLog: { create: jest.fn(async ({ data }: any) => logs.push(data)) },
    };
    const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
    const replies = [
      JSON.stringify({
        isFood: true,
        items: [{ dishName: 'Bánh xèo', possibleNames: [], portion: { amount: 1, unit: 'cái' }, confidence: 0.9 }],
      }),
      JSON.stringify({ estimates: [{ dishName: 'Bánh xèo', calories: 400, protein: 15, carb: 40, fat: 20 }] }),
    ];
    let i = 0;
    svc.genAI = {
      getGenerativeModel: () => ({
        generateContent: async () => {
          const reply = replies[Math.min(i, 1)];
          i += 1;
          return {
            response: {
              text: () => reply,
              usageMetadata: { promptTokenCount: 800 + i, candidatesTokenCount: 100 + i },
            },
          };
        },
      }),
    };
    await svc.analyzeFoodImageBase64('aGVsbG8=', 'image/jpeg', 'u1');
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.userId === 'u1' && l.feature === 'food_recognition')).toBe(true);
    expect(logs.map((l) => l.promptTokens)).toEqual([801, 802]);
  });
});
