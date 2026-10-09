import { HttpException } from '@nestjs/common';
import { AiService } from './ai.service';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';

/** Bộ đếm UsageCounter giả trong bộ nhớ, hỗ trợ UPDATE có điều kiện như Postgres. */
function build(opts: { premium?: boolean; user?: any } = {}) {
  const row: Record<string, number> = {
    aiPhoto: 0, chatTokens: 0, chatMessages: 0, menuScans: 0, suggestMeals: 0, barcodeLookups: 0,
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({
        timezone: 'Asia/Ho_Chi_Minh', purchasedAiQuota: 0, purchasedChatQuota: 0, ...opts.user,
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
        opts.premium ? { status: 'ACTIVE', expiryTime: new Date(Date.now() + 86400000) } : null,
      ),
    },
    manualGrant: { findFirst: jest.fn(async () => null) },
    apiUsageLog: { create: jest.fn(async () => ({})) },
    meal: { findMany: jest.fn(async () => []) },
    aiMessage: { deleteMany: jest.fn(async () => ({})), findMany: jest.fn(async () => []), createMany: jest.fn() },
  };
  const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
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

describe('Hạn mức AI Coach theo gói', () => {
  it('Free: 10 tin nhắn/ngày, tin thứ 11 nhận QUOTA_EXCEEDED kèm đủ thông tin', async () => {
    const { svc } = build();
    for (let i = 0; i < 10; i++) await svc.reserveChat('u1');
    const err = await rejection(svc.reserveChat('u1'));
    expect(err).toBeInstanceOf(QuotaExceededException);
    const body = err.getResponse();
    expect(err.getStatus()).toBe(429);
    expect(body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      feature: 'AI_COACH',
      limit: 10,
      used: 10,
      period: 'day',
      upgrade: true,
    });
    expect(body.resetsAt).toBeTruthy();
    expect(body.message).toContain('10/10 tin nhắn');
    expect(body.message).toContain('Premium');
  });

  it('20 tin nhắn gửi đồng thời khi hạn mức là 10: đúng 10 tin được nhận', async () => {
    const { svc } = build();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => svc.reserveChat('u1')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(10);
  });

  it('xử lý lỗi thì hoàn lượt tin nhắn', async () => {
    const { svc, row } = build();
    const r = await svc.reserveChat('u1');
    expect(row.chatMessages).toBe(1);
    await svc.releaseChat('u1', r);
    expect(row.chatMessages).toBe(0);
  });

  it('tin nhắn Free đã đếm lúc giữ chỗ nên khi xong chỉ cộng token, không đếm hai lần', async () => {
    const { svc, row } = build();
    const r = await svc.reserveChat('u1');
    await svc.deductChatQuotaAfterSuccess('u1', r, { promptTokens: 800, outputTokens: 200, costUsd: 0 });
    expect(row.chatMessages).toBe(1);
    expect(row.chatTokens).toBe(1000);
  });

  it('Free: token không làm hết hạn mức, chỉ số tin nhắn mới tính', async () => {
    const { svc, row } = build();
    row.chatTokens = 500000;
    row.chatMessages = 3;
    const q = await svc.getDailyChatQuota('u1');
    expect(q).toMatchObject({ unit: 'MESSAGES', limit: 10, used: 3, hasQuota: true, currentTier: 'FREE' });
  });

  it('Premium: 50.000 token/ngày, không bị giới hạn 10 tin nhắn', async () => {
    const { svc, row } = build({ premium: true });
    row.chatMessages = 400;
    row.chatTokens = 49000;
    const q = await svc.getDailyChatQuota('u1');
    expect(q).toMatchObject({ unit: 'TOKENS', limit: 50000, used: 49000, hasQuota: true, currentTier: 'PREMIUM' });
    await expect(svc.reserveChat('u1')).resolves.toBeDefined();
  });

  it('Premium hết token thì QUOTA_EXCEEDED tính theo token và không mời nâng cấp', async () => {
    const { svc, row } = build({ premium: true });
    row.chatTokens = 50000;
    const err = await rejection(svc.reserveChat('u1'));
    expect(err.getResponse()).toMatchObject({ code: 'QUOTA_EXCEEDED', limit: 50000, used: 50000, unit: 'token', upgrade: false });
    expect(err.getResponse().message).not.toContain('Mở Premium');
  });

  it('Premium: 20 tin nhắn đồng thời đều được cộng token đủ, không mất lượt tính', async () => {
    const { svc, row } = build({ premium: true });
    const r = await svc.reserveChat('u1');
    await Promise.all(Array.from({ length: 20 }, () => svc.deductChatQuotaAfterSuccess('u1', r, { promptTokens: 1000, outputTokens: 0, costUsd: 0 })));
    expect(row.chatTokens).toBe(20000);
    expect(row.chatMessages).toBe(20);
  });
});

describe('Hạn mức quét thực đơn và gợi ý món theo gói', () => {
  it('quét thực đơn: Free 1 lần/ngày, lần 2 bị chặn; bộ đếm riêng, không trừ lượt nhận diện ảnh', async () => {
    const { svc, row } = build();
    await svc.reserveFeature('u1', 'AI_MENU_SCAN');
    const err = await rejection(svc.reserveFeature('u1', 'AI_MENU_SCAN'));
    expect(err.getResponse()).toMatchObject({ feature: 'AI_MENU_SCAN', limit: 1, upgrade: true });
    expect(row.menuScans).toBe(1);
    expect(row.aiPhoto).toBe(0);
  });

  it('quét thực đơn: Premium 5 lần/ngày', async () => {
    const { svc } = build({ premium: true });
    for (let i = 0; i < 5; i++) await svc.reserveFeature('u1', 'AI_MENU_SCAN');
    const err = await rejection(svc.reserveFeature('u1', 'AI_MENU_SCAN'));
    expect(err.getResponse()).toMatchObject({ limit: 5, upgrade: false });
  });

  it('gợi ý món: Free 2 lượt/ngày', async () => {
    const { svc } = build();
    await svc.reserveFeature('u1', 'AI_SUGGEST_MEAL');
    await svc.reserveFeature('u1', 'AI_SUGGEST_MEAL');
    const err = await rejection(svc.reserveFeature('u1', 'AI_SUGGEST_MEAL'));
    expect(err.getResponse()).toMatchObject({ feature: 'AI_SUGGEST_MEAL', limit: 2, used: 2 });
  });

  it('hai yêu cầu đồng thời khi chỉ còn một lượt: đúng một yêu cầu được giữ chỗ', async () => {
    const { svc } = build();
    const results = await Promise.allSettled([svc.reserveFeature('u1', 'AI_MENU_SCAN'), svc.reserveFeature('u1', 'AI_MENU_SCAN')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('gợi ý món gặp lỗi (hồ sơ chưa đủ) thì hoàn lượt, người dùng không mất lượt vô ích', async () => {
    const { svc, row } = build({ user: { targetCalories: null, goal: 'MAINTAIN', allergies: [], dietType: 'OMNIVORE' } });
    await expect(svc.suggestMeal('u1')).rejects.toBeInstanceOf(ProfileIncompleteException);
    expect(row.suggestMeals).toBe(0);
  });

  it('QuotaExceededException là HttpException 429 mang code QUOTA_EXCEEDED', () => {
    const e = new QuotaExceededException({ feature: 'WEEKLY_CHECKIN', limit: 1, used: 1, period: 'month', resetsAt: new Date('2026-11-01T00:00:00Z') });
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getResponse()).toMatchObject({ code: 'QUOTA_EXCEEDED', period: 'month', resetsAt: '2026-11-01T00:00:00.000Z' });
    expect((e.getResponse() as any).message).toContain('tháng này');
  });
});
