import { AnalyticsService } from './analytics.service';

const mondays = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const add = (key: string, n: number) =>
  new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Mỗi tuần một điểm xu hướng cân vào thứ Tư. */
const trend = (pairs: [string, number][]) =>
  pairs.map(([monday, w]) => ({ date: add(monday, 2), trendWeight: w }));

/** Mọi ngày trong các tuần chỉ định đều ghi đủ 2 bữa ≥ 60% mục tiêu. */
function mealsFor(weeks: string[], daysPerWeek = 7) {
  const rows: any[] = [];
  for (const w of weeks) {
    for (let d = 0; d < daysPerWeek; d++) {
      const logDate = new Date(`${add(w, d)}T00:00:00Z`);
      rows.push({ logDate, totalCalories: 900 }, { logDate, totalCalories: 900 });
    }
  }
  return rows;
}

function build(opts: {
  goal?: string;
  rate?: number;
  trend: { date: string; trendWeight: number }[];
  meals: any[];
  premium?: boolean;
  programType?: string;
}) {
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({
        weightKg: 80,
        weightRateKgPerWeek: opts.rate ?? 0.5,
        goal: opts.goal ?? 'LOSE_WEIGHT',
        programType: opts.programType ?? 'COACHED',
        targetCalories: 2000,
      })),
    },
    meal: { findMany: jest.fn(async () => opts.meals) },
    dailyLogStatus: { findMany: jest.fn(async () => []) },
    subscriptionState: {
      findUnique: jest.fn(async () =>
        opts.premium ? { status: 'ACTIVE', expiryTime: new Date(Date.now() + 86400000) } : null,
      ),
    },
    manualGrant: { findFirst: jest.fn(async () => null) },
  };
  const weights: any = { getWeightTrend: jest.fn(async () => ({ data: opts.trend })) };
  return new AnalyticsService(prisma, weights);
}

afterEach(() => delete process.env.BILLING_ENFORCE);

const flat = trend(mondays.slice(0, 4).map((m) => [m, 80] as [string, number])); // 4 tuần liên tiếp đi ngang
const flatWeeks = mondays.slice(1, 4); // tuần của 3 mức thay đổi

describe('P1 Insight Plateau', () => {
  it('giảm cân, 3 tuần liên tiếp đi ngang và ghi đủ dữ liệu → có Plateau', async () => {
    const svc = build({ trend: flat, meals: mealsFor(flatWeeks) });
    const res = (await svc.getInsights('u1')).data.insights;
    expect(res.map((i) => i.type)).toContain('PLATEAU');
    expect(res.find((i) => i.type === 'PLATEAU')!.locked).toBe(false);
  });

  it('người đang DUY TRÌ đi ngang là thành công → KHÔNG báo Plateau', async () => {
    const svc = build({ goal: 'MAINTAIN', trend: flat, meals: mealsFor(flatWeeks) });
    expect((await svc.getInsights('u1')).data.insights).toEqual([]);
  });

  it('dữ liệu thưa (chỉ 3 ngày đủ mỗi tuần) → KHÔNG báo, tránh kết luận từ số liệu thiếu', async () => {
    const svc = build({ trend: flat, meals: mealsFor(flatWeeks, 3) });
    expect((await svc.getInsights('u1')).data.insights).toEqual([]);
  });

  it('chỉ một tuần trong ba tuần thiếu dữ liệu cũng không báo', async () => {
    const svc = build({ trend: flat, meals: [...mealsFor(flatWeeks.slice(0, 2)), ...mealsFor([flatWeeks[2]], 2)] });
    expect((await svc.getInsights('u1')).data.insights).toEqual([]);
  });

  it('tuần không có cân cắt đứt chuỗi: không nối hai tuần cách nhau rồi coi như thay đổi trong một tuần', async () => {
    // tuần 1, 2 có cân; bỏ tuần 3; tuần 4, 5 có cân → không đủ 3 mức thay đổi LIỀN NHAU
    const gap = trend([
      [mondays[0], 80], [mondays[1], 80], [mondays[3], 80], [mondays[4], 80],
    ]);
    const svc = build({ trend: gap, meals: mealsFor(mondays) });
    expect((await svc.getInsights('u1')).data.insights).toEqual([]);
  });

  it('cân vẫn giảm đều (-0,5 kg/tuần) thì không phải Plateau', async () => {
    const dropping = trend(mondays.slice(0, 4).map((m, i) => [m, 80 - i * 0.5] as [string, number]));
    const svc = build({ trend: dropping, meals: mealsFor(flatWeeks) });
    expect((await svc.getInsights('u1')).data.insights).toEqual([]);
  });

  it('chưa đủ dữ liệu cân hoặc chưa có mục tiêu → không có insight', async () => {
    expect((await build({ trend: [], meals: [] }).getInsights('u1')).data.insights).toEqual([]);
    expect((await build({ trend: flat.slice(0, 2), meals: [] }).getInsights('u1')).data.insights).toEqual([]);
  });

  it('nội dung nhắc khác nhau theo chương trình: MANUAL xem lại mục tiêu, còn lại chờ Check-in', async () => {
    const manual = (await build({ programType: 'MANUAL', trend: flat, meals: mealsFor(flatWeeks) }).getInsights('u1')).data.insights[0];
    const coached = (await build({ trend: flat, meals: mealsFor(flatWeeks) }).getInsights('u1')).data.insights[0];
    expect(manual.message).toContain('phần Mục tiêu');
    expect(coached.message).toContain('Check-in');
  });
});

describe('P1 Insight lệch mục tiêu', () => {
  // Mục tiêu giảm 0,5 kg/tuần nhưng cân tăng +0,3 kg mỗi tuần trong 2 tuần liền
  const rising = trend(mondays.slice(0, 3).map((m, i) => [m, 80 + i * 0.3] as [string, number]));
  const risingWeeks = mondays.slice(1, 3);

  it('2 tuần liền lệch > 50% và đủ dữ liệu → báo', async () => {
    const res = (await build({ trend: rising, meals: mealsFor(risingWeeks) }).getInsights('u1')).data.insights;
    expect(res.map((i) => i.type)).toContain('GOAL_DEVIATION');
  });

  it('thiếu dữ liệu ghi bữa thì không báo', async () => {
    const res = (await build({ trend: rising, meals: mealsFor(risingWeeks, 2) }).getInsights('u1')).data.insights;
    expect(res).toEqual([]);
  });

  it('người đang Duy trì không bị báo lệch mục tiêu', async () => {
    const res = (await build({ goal: 'MAINTAIN', trend: rising, meals: mealsFor(risingWeeks) }).getInsights('u1')).data.insights;
    expect(res).toEqual([]);
  });
});

describe('Insight phân tầng Free / Premium', () => {
  const args = { trend: flat, meals: mealsFor(flatWeeks) }; // giảm cân mà đi ngang: có cả Plateau lẫn Lệch mục tiêu

  it('đang bật khoá, Free: thấy 1 insight nổi bật đầy đủ, các insight còn lại chỉ có tiêu đề', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const insights = (await build({ ...args }).getInsights('u1')).data.insights;
    expect(insights.length).toBe(2);
    expect(insights[0]).toMatchObject({ type: 'PLATEAU', locked: false });
    expect(insights[0].message).not.toBe('');
    expect(insights[1].locked).toBe(true);
    expect(insights[1].message).toBe('');
    expect(insights[1].title).toBeTruthy();
  });

  it('đang bật khoá, Free chỉ có 1 insight: vẫn thấy đầy đủ, không bị khoá', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const rising = trend(mondays.slice(0, 3).map((m, i) => [m, 80 + i * 0.3] as [string, number]));
    const insights = (await build({ trend: rising, meals: mealsFor(mondays.slice(1, 3)) }).getInsights('u1')).data.insights;
    expect(insights).toHaveLength(1);
    expect(insights[0].locked).toBe(false);
    expect(insights[0].message).not.toBe('');
  });

  it('đang bật khoá, Premium: thấy tất cả đầy đủ', async () => {
    process.env.BILLING_ENFORCE = 'true';
    const insights = (await build({ ...args, premium: true }).getInsights('u1')).data.insights;
    expect(insights.every((i) => !i.locked && i.message !== '')).toBe(true);
  });

  it('chưa bật khoá (đang thử nghiệm): mọi người thấy đầy đủ', async () => {
    const insights = (await build({ ...args }).getInsights('u1')).data.insights;
    expect(insights.every((i) => !i.locked && i.message !== '')).toBe(true);
  });
});
