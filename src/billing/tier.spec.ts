import { CheckinsService } from '../checkins/checkins.service';
import { WeeklySummaryService } from '../weekly-summary/weekly-summary.service';
import { UsersService } from '../users/users.service';
import { AiService } from '../ai/ai.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { PLAN_LIMITS } from './billing.constants';

const DAY = 86400000;

function plans(premium: boolean) {
  return {
    subscriptionState: {
      findUnique: jest.fn(async () => (premium ? { status: 'ACTIVE', expiryTime: new Date(Date.now() + DAY) } : null)),
    },
    manualGrant: { findFirst: jest.fn(async () => null) },
  };
}

beforeEach(() => {
  process.env.BILLING_ENFORCE = 'true';
});
afterEach(() => {
  delete process.env.BILLING_ENFORCE;
  jest.restoreAllMocks();
});

describe('Bảng hạn mức theo gói khớp đặc tả Free/Premium', () => {
  it('Free: 5 ảnh, 1 quét thực đơn, 2 gợi ý món, 10 tin chat, 1 Check-in/tháng, lịch sử 7 ngày / 3 ngày', () => {
    expect(PLAN_LIMITS.FREE).toMatchObject({
      aiPhotoPerDay: 5, menuScanPerDay: 1, suggestMealPerDay: 2, chatMessagesPerDay: 10,
      chatTokensPerDay: null, checkinPerMonth: 1, expenditureHistoryDays: 7, chatHistoryDays: 3, planPreviewDays: 7,
    });
  });
  it('Premium: 30 ảnh, 5 quét thực đơn, chat 50.000 token/ngày (không "vô hạn"), Check-in hằng tuần, lịch sử đầy đủ', () => {
    expect(PLAN_LIMITS.PREMIUM).toMatchObject({
      aiPhotoPerDay: 30, menuScanPerDay: 5, chatMessagesPerDay: null, chatTokensPerDay: 50000,
      checkinPerMonth: null, expenditureHistoryDays: null, chatHistoryDays: 7, planPreviewDays: null,
    });
    expect(PLAN_LIMITS.PREMIUM.barcodePerDay).toBeLessThan(Infinity);
  });
});

describe('Check-in: Free 1 lần/tháng', () => {
  function build(premium: boolean, usedThisMonth: number) {
    const prisma: any = { ...plans(premium), checkIn: { count: jest.fn(async () => usedThisMonth) } };
    const svc: any = Object.create(CheckinsService.prototype);
    svc.prisma = prisma;
    return { svc, prisma };
  }

  it('Free chưa có Check-in nào trong tháng → được tạo', async () => {
    const { svc } = build(false, 0);
    await expect(svc.assertCheckinQuota('u1', 'Asia/Ho_Chi_Minh')).resolves.toBeUndefined();
  });

  it('Free đã có 1 Check-in trong tháng → QUOTA_EXCEEDED theo tháng, kèm thời điểm làm mới', async () => {
    const { svc } = build(false, 1);
    const err: any = await svc.assertCheckinQuota('u1', 'Asia/Ho_Chi_Minh').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededException);
    expect(err.getResponse()).toMatchObject({ feature: 'WEEKLY_CHECKIN', limit: 1, used: 1, period: 'month', upgrade: true });
    const resets = new Date(err.getResponse().resetsAt);
    expect(resets.getTime()).toBeGreaterThan(Date.now());
    expect(resets.getTime() - Date.now()).toBeLessThanOrEqual(32 * DAY);
  });

  it('Premium không bị giới hạn theo tháng', async () => {
    const { svc, prisma } = build(true, 5);
    await expect(svc.assertCheckinQuota('u1', 'Asia/Ho_Chi_Minh')).resolves.toBeUndefined();
    expect(prisma.checkIn.count).not.toHaveBeenCalled();
  });

  it('chưa bật khoá (đang thử nghiệm): không giới hạn', async () => {
    delete process.env.BILLING_ENFORCE;
    const { svc } = build(false, 9);
    await expect(svc.assertCheckinQuota('u1', 'Asia/Ho_Chi_Minh')).resolves.toBeUndefined();
  });
});

describe('Weekly Summary: Free xem một phần', () => {
  const full = {
    weekStartDate: '2026-10-05', weekEndDate: '2026-10-11', avgCalories: 1850, avgProtein: 120, avgFat: 55, avgCarb: 210,
    weightChangeKg: -0.4, workoutsCompleted: 3, highlightText: 'Tuần này bạn ăn rất đều.', isFallback: false,
    generatedAt: '2026-10-11T00:00:00.000Z', isPreview: false,
  };
  const build = (premium: boolean) => {
    const svc: any = Object.create(WeeklySummaryService.prototype);
    svc.prisma = plans(premium);
    return svc;
  };

  it('Free: giữ calo trung bình, cân nặng, số buổi tập; ẩn macro và lời nhận xét AI; đánh dấu bản xem trước', async () => {
    const res = await build(false).applyTier('u1', full);
    expect(res).toMatchObject({ avgCalories: 1850, weightChangeKg: -0.4, workoutsCompleted: 3, isPreview: true });
    expect(res.avgProtein).toBeNull();
    expect(res.avgFat).toBeNull();
    expect(res.avgCarb).toBeNull();
    expect(res.highlightText).toBe('');
  });

  it('Premium: đầy đủ', async () => {
    const res = await build(true).applyTier('u1', full);
    expect(res).toMatchObject({ avgProtein: 120, highlightText: 'Tuần này bạn ăn rất đều.', isPreview: false });
  });

  it('chưa bật khoá: đầy đủ cho mọi người', async () => {
    delete process.env.BILLING_ENFORCE;
    const res = await build(false).applyTier('u1', full);
    expect(res.isPreview).toBe(false);
    expect(res.highlightText).not.toBe('');
  });
});

describe('Lịch sử Expenditure: Free 7 ngày', () => {
  const history = [20, 10, 6, 3, 0].map((daysAgo, i) => ({ id: `s${i}`, recordedAt: new Date(Date.now() - daysAgo * DAY - 1000) }));
  const build = (premium: boolean) => {
    const adaptive: any = { getHistory: jest.fn(async () => history) };
    return new UsersService({ ...plans(premium) } as any, {} as any, adaptive);
  };

  it('Free chỉ thấy các điểm trong 7 ngày gần nhất và biết giới hạn', async () => {
    const res: any = await build(false).getExpenditureHistory('u1');
    expect(res.data.map((h: any) => h.id)).toEqual(['s2', 's3', 's4']);
    expect(res.limitedToDays).toBe(7);
  });

  it('Premium xem đầy đủ', async () => {
    const res: any = await build(true).getExpenditureHistory('u1');
    expect(res.data).toHaveLength(5);
    expect(res.limitedToDays).toBeNull();
  });
});

describe('Lịch sử chat: Free 3 ngày, Premium 7 ngày', () => {
  function build(premium: boolean) {
    const findMany = jest.fn(async () => []);
    const prisma: any = {
      ...plans(premium),
      aiMessage: { deleteMany: jest.fn(async () => ({})), findMany },
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      usageCounter: { findUnique: jest.fn(async () => null) },
    };
    return { svc: new AiService({ get: () => undefined } as any, prisma, {} as any), findMany };
  }
  const daysBack = (findMany: jest.Mock) => {
    const since: Date = (findMany.mock.calls[0] as any)[0].where.createdAt.gte;
    return Math.round((Date.now() - since.getTime()) / DAY);
  };

  it('Free chỉ thấy 3 ngày gần nhất', async () => {
    const { svc, findMany } = build(false);
    await svc.getChatHistory('u1');
    expect(daysBack(findMany)).toBe(3);
  });

  it('Premium thấy 7 ngày', async () => {
    const { svc, findMany } = build(true);
    await svc.getChatHistory('u1');
    expect(daysBack(findMany)).toBe(7);
  });
});

describe('Tra mã vạch: Free có giới hạn', () => {
  function build(premium: boolean) {
    const row = { barcodeLookups: 0 };
    const prisma: any = {
      ...plans(premium),
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      usageCounter: {
        upsert: jest.fn(async () => ({})),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const cond = where.barcodeLookups;
          if (cond.lt !== undefined && !(row.barcodeLookups < cond.lt)) return { count: 0 };
          if (cond.gt !== undefined && !(row.barcodeLookups > cond.gt)) return { count: 0 };
          row.barcodeLookups += data.barcodeLookups.increment ?? -data.barcodeLookups.decrement;
          return { count: 1 };
        }),
      },
    };
    return { svc: new RecommendationsService(prisma), row };
  }
  const found = { status: 1, product: { product_name: 'Sữa', nutriments: {} } };

  it('Free dùng hết 5 lượt thì lượt thứ 6 nhận QUOTA_EXCEEDED', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => found } as any);
    const { svc } = build(false);
    for (let i = 0; i < 5; i++) await svc.lookupBarcode('u1', '8934563138165');
    const err: any = await svc.lookupBarcode('u1', '8934563138165').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededException);
    expect(err.getResponse()).toMatchObject({ feature: 'BARCODE', limit: 5, upgrade: true });
  });

  it('lỗi mạng khi tra cứu thì hoàn lượt', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    const { svc, row } = build(false);
    const res: any = await svc.lookupBarcode('u1', '123');
    expect(res.data).toBeNull();
    expect(row.barcodeLookups).toBe(0);
  });

  it('không tìm thấy sản phẩm vẫn tính một lượt', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ status: 0 }) } as any);
    const { svc, row } = build(false);
    await svc.lookupBarcode('u1', '000');
    expect(row.barcodeLookups).toBe(1);
  });

  it('Premium có hạn mức cao hơn nhiều (nhưng vẫn hữu hạn)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => found } as any);
    const { svc } = build(true);
    for (let i = 0; i < 6; i++) await svc.lookupBarcode('u1', '8934563138165');
    await expect(svc.lookupBarcode('u1', '8934563138165')).resolves.toBeDefined();
  });
});
