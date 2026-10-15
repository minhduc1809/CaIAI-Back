import { AiService } from './ai.service';
import { AiHealthMonitor } from './ai-health.monitor';

/** Bộ đếm UsageCounter giả trong bộ nhớ (như feature-quota.spec), không có GEMINI_API_KEY nên AI luôn không khả dụng. */
function build(opts: { premium?: boolean; user?: any } = {}) {
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
      findUnique: jest.fn(async () => ({
        timezone: 'Asia/Ho_Chi_Minh',
        purchasedAiQuota: 0,
        purchasedChatQuota: 0,
        ...opts.user,
      })),
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
    subscriptionState: {
      findUnique: jest.fn(async () =>
        opts.premium
          ? { status: 'ACTIVE', expiryTime: new Date(Date.now() + 86400000) }
          : null,
      ),
    },
    manualGrant: { findFirst: jest.fn(async () => null) },
    apiUsageLog: { create: jest.fn(async () => ({})) },
    meal: { findMany: jest.fn(async () => []) },
    aiMessage: {
      deleteMany: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      createMany: jest.fn(),
    },
  };
  const svc: any = new AiService(
    { get: () => undefined } as any,
    prisma,
    {} as any,
  );
  return { svc, row, prisma };
}

const rejection = async (p: Promise<unknown>): Promise<any> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('Lẽ ra phải ném lỗi');
};

const NO_TARGET = { targetCalories: null, targetProtein: null };
const WITH_TARGET = { targetCalories: 2000, targetProtein: 120, goal: 'LOSE_WEIGHT' };

describe('G2 / BR-11.2: Smart Fallback không bịa số dinh dưỡng', () => {
  it('chat khi AI không khả dụng: đánh dấu fallback và KHÔNG trừ lượt/token', async () => {
    const { svc, row } = build({ user: WITH_TARGET });
    const res = await svc.chat('u1', 'Tối nay ăn gì?');
    expect(res.isFallback).toBe(true);
    expect(row.chatMessages).toBe(0);
    expect(row.chatTokens).toBe(0);
  });

  it('người dùng chưa có mục tiêu: câu trả lời không chứa chữ số nào', async () => {
    const { svc } = build({ user: NO_TARGET });
    for (const q of ['Tối nay ăn gì?', 'Tập gym thế nào?', 'Xin chào']) {
      const res = await svc.chat('u1', q);
      expect(res.reply).not.toMatch(/\d/);
    }
  });

  it('có mục tiêu: chỉ nêu lượng còn lại thật của người dùng, không có số mẫu của món', async () => {
    const { svc } = build({ user: WITH_TARGET });
    const res = await svc.chat('u1', 'Gợi ý món cho bữa tối');
    expect(res.reply).toContain('2000 kcal');
    expect(res.reply).toContain('120g protein');
    for (const fake of ['420', '38g', '350', '35g', 'Phở gà ức']) {
      expect(res.reply).not.toContain(fake);
    }
    // Mọi con số trong câu trả lời đều là số còn lại thật (2000 và 120)
    const numbers = (res.reply.match(/\d+/g) ?? []).map(Number);
    expect(numbers.every((n: number) => n === 2000 || n === 120)).toBe(true);
  });

  it('đã đạt mục tiêu calo: không nêu số còn lại âm hay bằng 0', async () => {
    const { svc, prisma } = build({ user: WITH_TARGET });
    prisma.meal.findMany = jest.fn(async () => [
      { mealType: 'LUNCH', totalCalories: 2300, totalProtein: 90, totalCarb: 0, totalFat: 0, items: [] },
    ]);
    const res = await svc.chat('u1', 'Tối nay ăn gì?');
    expect(res.reply).not.toMatch(/\d/);
    expect(res.reply).toMatch(/đạt hoặc vượt/);
  });

  it('câu hỏi ngoài lề vẫn bị từ chối lịch sự khi dùng fallback', async () => {
    const { svc } = build({ user: WITH_TARGET });
    const res = await svc.chat('u1', 'Viết code python giúp tôi');
    expect(res.reply).toMatch(/chỉ hỗ trợ tư vấn dinh dưỡng/);
  });

  it('nhận diện ảnh khi AI lỗi: 503 AI_UNAVAILABLE, không có dữ liệu dinh dưỡng, hoàn lượt', async () => {
    const { svc, row } = build({ user: WITH_TARGET });
    const err = await rejection(svc.analyzeFoodImageBase64('aGVsbG8=', 'image/jpeg', 'u1'));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse().code).toBe('AI_UNAVAILABLE');
    expect(JSON.stringify(err.getResponse())).not.toMatch(/calories|protein|kcal/i);
    expect(row.aiPhoto).toBe(0);
  });
});

describe('Cảnh báo tỉ lệ lỗi AI (BR-11.2)', () => {
  const opts = { ratePct: 20, windowMs: 15 * 60_000, minSamples: 5 };
  const T0 = 1_700_000_000_000;
  const make = () => {
    const alerts: string[] = [];
    return { alerts, m: new AiHealthMonitor((a) => alerts.push(a), () => opts) };
  };

  it('báo khi tỉ lệ lỗi vượt 20% trong cửa sổ và đủ số mẫu', () => {
    const { m, alerts } = make();
    for (let i = 0; i < 6; i++) m.recordSuccess(T0 + i);
    m.recordFailure(T0 + 10);
    expect(alerts).toHaveLength(0); // 1/7 ≈ 14%
    m.recordFailure(T0 + 11); // 2/8 = 25%
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/AI_UNAVAILABLE_RATE/);
  });

  it('không báo oan khi chưa đủ số mẫu tối thiểu', () => {
    const { m, alerts } = make();
    m.recordFailure(T0);
    m.recordFailure(T0 + 1);
    expect(alerts).toHaveLength(0);
  });

  it('đúng ngưỡng 20% thì chưa báo (chỉ báo khi LỚN HƠN)', () => {
    const { m, alerts } = make();
    for (let i = 0; i < 4; i++) m.recordSuccess(T0 + i);
    m.recordFailure(T0 + 10); // 1/5 = 20%
    expect(alerts).toHaveLength(0);
  });

  it('không báo dồn dập: một cảnh báo mỗi cửa sổ, hết cửa sổ mới báo lại', () => {
    const { m, alerts } = make();
    for (let i = 0; i < 6; i++) m.recordFailure(T0 + i);
    expect(alerts).toHaveLength(1);
    m.recordFailure(T0 + 60_000);
    expect(alerts).toHaveLength(1);
    const later = T0 + opts.windowMs + 1000;
    for (let i = 0; i < 6; i++) m.recordFailure(later + i);
    expect(alerts).toHaveLength(2);
  });

  it('lỗi cũ ngoài cửa sổ không còn được tính', () => {
    const { m } = make();
    for (let i = 0; i < 6; i++) m.recordFailure(T0 + i);
    expect(m.snapshot(T0 + opts.windowMs + 10_000)).toEqual({ total: 0, failed: 0, ratePct: 0 });
  });
});
