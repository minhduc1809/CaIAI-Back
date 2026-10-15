import { BadRequestException } from '@nestjs/common';
import { AdminAiUsageService } from './services/admin-ai-usage.service';

function build(rows: { userId: string; feature: string; status: string; p: number; o: number; cost: number; latency: number }[]) {
  const matches = (where: any) =>
    rows.filter((r) => (where.status === undefined ? true : r.status === where.status));
  const prisma: any = {
    apiUsageLog: {
      aggregate: jest.fn(async ({ where }: any) => {
        const list = matches(where);
        return {
          _count: { _all: list.length },
          _sum: {
            promptTokens: list.reduce((a, r) => a + r.p, 0),
            outputTokens: list.reduce((a, r) => a + r.o, 0),
            costUsd: list.reduce((a, r) => a + r.cost, 0),
          },
        };
      }),
      count: jest.fn(async ({ where }: any) => matches(where).length),
      groupBy: jest.fn(async ({ by }: any) => {
        const key = (r: any) => by.map((b: string) => r[b]).join('|');
        const groups = new Map<string, any[]>();
        for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
        return [...groups.values()].map((list) => {
          const first = list[0];
          const out: any = { _count: { _all: list.length } };
          for (const b of by) out[b] = first[b];
          out._sum = {
            promptTokens: list.reduce((a, r) => a + r.p, 0),
            outputTokens: list.reduce((a, r) => a + r.o, 0),
            costUsd: list.reduce((a, r) => a + r.cost, 0),
          };
          out._avg = { latencyMs: list.reduce((a, r) => a + r.latency, 0) / list.length };
          return out;
        });
      }),
    },
  };
  return { service: new AdminAiUsageService(prisma), prisma };
}

const row = (userId: string, feature: string, cost: number, status = 'OK', latency = 1000) => ({
  userId, feature, status, p: 1000, o: 200, cost, latency,
});

describe('Báo cáo chi phí AI cho quản trị (BR-15.5)', () => {
  it('tổng, theo tính năng (xếp theo chi phí giảm dần), tỉ lệ lỗi và độ trễ trung bình', async () => {
    const { service } = build([
      row('u1', 'chat_coach', 0.01, 'OK', 800),
      row('u1', 'chat_coach', 0.01, 'OK', 1200),
      row('u2', 'food_recognition', 0.05, 'OK', 3000),
      row('u2', 'food_recognition', 0, 'ERROR', 500),
    ]);
    const r = await service.getUsage('2026-10');
    expect(r.month).toBe('2026-10');
    expect(r.totals).toMatchObject({ calls: 4, errors: 1, errorRatePct: 25, promptTokens: 4000, outputTokens: 800 });
    expect(r.totals.costUsd).toBeCloseTo(0.07, 6);
    expect(r.byFeature.map((f) => f.feature)).toEqual(['food_recognition', 'chat_coach']);
    const photo = r.byFeature[0];
    expect(photo).toMatchObject({ calls: 2, errors: 1, errorRatePct: 50 });
    expect(r.byFeature[1]).toMatchObject({ calls: 2, errors: 0, avgLatencyMs: 1000 });
  });

  it('chi phí mỗi người dùng theo tháng chia nhóm nhẹ/trung bình/nặng', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`u${i}`, 'chat_coach', (i + 1) / 100));
    const { service } = build(rows);
    const r = await service.getUsage('2026-10');
    expect(r.perUserMonthlyCostUsd).toMatchObject({ users: 20, p50: 0.1, p75: 0.15, p95: 0.19, max: 0.2 });
    expect(r.perUserMonthlyCostUsd.p95).toBeGreaterThan(r.perUserMonthlyCostUsd.p50);
  });

  it('cảnh báo chất lượng dữ liệu: đếm số lời gọi Gemini không trả usageMetadata', async () => {
    const { service } = build([row('u1', 'chat_coach', 0, 'OK_NO_USAGE'), row('u1', 'chat_coach', 0.01)]);
    expect((await service.getUsage('2026-10')).totals.callsWithoutUsage).toBe(1);
  });

  it('không có dữ liệu: toàn số 0, không chia cho 0', async () => {
    const { service } = build([]);
    const r = await service.getUsage('2026-10');
    expect(r.totals).toMatchObject({ calls: 0, errorRatePct: 0, costUsd: 0 });
    expect(r.byFeature).toEqual([]);
    expect(r.perUserMonthlyCostUsd.users).toBe(0);
  });

  it('lọc đúng theo tháng UTC; bỏ trống thì lấy tháng hiện tại', async () => {
    const { service, prisma } = build([]);
    await service.getUsage('2026-12');
    const where = prisma.apiUsageLog.aggregate.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(where.createdAt.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');

    const cur = await service.getUsage(undefined, new Date('2026-10-13T03:00:00Z'));
    expect(cur.month).toBe('2026-10');
  });

  it.each(['2026-13', '2026-1', 'tháng 10', '2026/10', '2026-00'])('tháng không hợp lệ "%s" bị từ chối', async (m) => {
    const { service } = build([]);
    await expect(service.getUsage(m)).rejects.toBeInstanceOf(BadRequestException);
  });
});
