import { Test, TestingModule } from '@nestjs/testing';
import { AdaptiveExpenditureService } from './adaptive-expenditure.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { HealthCalculatorService } from './health-calculator.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Nhóm D - Adaptive Expenditure Engine & Cân nặng (BR-05.3, BR-05.5, BR-05.6, BR-05.7, BR-09.4)', () => {
  let adaptiveService: AdaptiveExpenditureService;
  let weightLogsService: WeightLogsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      weightLog: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      meal: {
        findMany: jest.fn(),
      },
      dailyLogStatus: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      expenditureSnapshot: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      goal: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdaptiveExpenditureService,
        WeightLogsService,
        HealthCalculatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    adaptiveService = module.get<AdaptiveExpenditureService>(
      AdaptiveExpenditureService,
    );
    weightLogsService = module.get<WeightLogsService>(WeightLogsService);
  });

  describe('D1 & D6: effectiveWeights - Gom ngày & Lọc cân ngoại lai', () => {
    it('D6: gom nhiều lần cân trong cùng ngày thành trung bình ngày', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      // Cân ngày 2026-10-01 ba lần: 70kg sáng, 71kg chiều, 70.5kg tối
      const date1A = new Date('2026-10-01T07:00:00+07:00');
      const date1B = new Date('2026-10-01T12:00:00+07:00');
      const date1C = new Date('2026-10-01T19:00:00+07:00');
      const date2 = new Date('2026-10-02T07:00:00+07:00');

      prisma.weightLog.findMany.mockResolvedValue([
        { id: '1', date: date1A, weightKg: 70.0, createdAt: date1A },
        { id: '2', date: date1B, weightKg: 71.0, createdAt: date1B },
        { id: '3', date: date1C, weightKg: 70.5, createdAt: date1C },
        { id: '4', date: date2, weightKg: 70.2, createdAt: date2 },
      ]);

      const result = await weightLogsService.effectiveWeights('u1');
      expect(result.length).toBe(2);
      expect(result[0].dateKey).toBe('2026-10-01');
      expect(result[0].avgWeight).toBeCloseTo(70.5, 2);
      expect(result[0].ids).toEqual(['1', '2', '3']);
      expect(result[1].dateKey).toBe('2026-10-02');
      expect(result[1].avgWeight).toBeCloseTo(70.2, 2);
    });

    it('D1: loại bỏ cân ngoại lai > max(2kg, 3%) nếu không được xác nhận trong 3 ngày', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      // Ngày 1: 70kg
      // Ngày 2: 150kg (nhầm lb) -> chênh 80kg >> threshold
      // Ngày 3: 70.1kg (không xác nhận 150kg)
      prisma.weightLog.findMany.mockResolvedValue([
        { id: '1', date: new Date('2026-10-01T07:00:00Z'), weightKg: 70.0 },
        { id: '2', date: new Date('2026-10-02T07:00:00Z'), weightKg: 150.0 },
        { id: '3', date: new Date('2026-10-03T07:00:00Z'), weightKg: 70.1 },
      ]);

      const result = await weightLogsService.effectiveWeights('u1');
      expect(result.length).toBe(3);
      expect(result[1].avgWeight).toBe(150.0);
      expect(result[1].isOutlier).toBe(true);
      expect(result[1].confirmed).toBe(false);

      // Khi tính trend, ngày 150kg bị bỏ qua
      const trend = await weightLogsService.getWeightTrend('u1');
      const trendData = trend.data;
      expect(trendData.length).toBe(2);
      expect(
        trendData.find((t: any) => t.loggedWeight === 150.0),
      ).toBeUndefined();
    });

    it('D1: chấp nhận biến động lớn nếu có lần cân tiếp theo trong 3 ngày cùng hướng (lệch < 1kg)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      // Ngày 1: 70kg
      // Ngày 2: 74kg (tăng 4kg > max(2, 2.1kg))
      // Ngày 3: 74.2kg (trong vòng 3 ngày, lệch 0.2kg < 1kg -> xác nhận)
      prisma.weightLog.findMany.mockResolvedValue([
        { id: '1', date: new Date('2026-10-01T07:00:00Z'), weightKg: 70.0 },
        { id: '2', date: new Date('2026-10-02T07:00:00Z'), weightKg: 74.0 },
        { id: '3', date: new Date('2026-10-03T07:00:00Z'), weightKg: 74.2 },
      ]);

      const result = await weightLogsService.effectiveWeights('u1');
      expect(result[1].isOutlier).toBe(false);
      expect(result[1].confirmed).toBe(true);
      expect(result[2].isOutlier).toBe(false);
    });
  });

  describe('D2, D3, D5: Adaptive Expenditure Engine states, confidence & convergence', () => {
    it('trả về trạng thái STATIC khi chưa đủ dữ liệu tối thiểu', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        targetCalories: 2000,
      });
      prisma.weightLog.findMany.mockResolvedValue([
        { id: '1', date: new Date(), weightKg: 70.0 },
      ]);

      const res = await adaptiveService.recalculate('u1', 2000);
      expect(res.status).toBe('STATIC');
      expect(res.confidence).toBe('LOW');
      expect(res.bandKcal).toBe(250);
      expect(res.method).toBe('STATIC_FALLBACK');
      expect(res.estimatedExpenditure).toBe(2000);
      expect(res.todoList.length).toBeGreaterThan(0);
    });

    it('trả về LEARNING và confidence LOW khi đủ dữ liệu cơ bản nhưng < 21 ngày hoặc < 10 ngày log', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        targetCalories: 2000,
      });
      // 5 ngày cân trải dài 12 ngày
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 12);
      const logs = [0, 3, 6, 9, 12].map((dayOffset, i) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + dayOffset);
        return { id: String(i), date: d, weightKg: 70 - i * 0.1 };
      });
      prisma.weightLog.findMany.mockResolvedValue(logs);

      // 6 ngày ăn đầy đủ (mỗi ngày 2 bữa để thỏa mãn isCompleteDay)
      const meals: { logDate: Date; totalCalories: number }[] = [];
      [0, 2, 4, 6, 8, 10].forEach((dayOffset) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + dayOffset);
        meals.push({ logDate: d, totalCalories: 1000 });
        meals.push({ logDate: d, totalCalories: 1000 });
      });
      prisma.meal.findMany.mockResolvedValue(meals);
      prisma.expenditureSnapshot.findFirst.mockResolvedValue(null);

      const res = await adaptiveService.recalculate('u1', 2000);
      expect(res.status).toBe('LEARNING');
      expect(res.confidence).toBe('LOW');
      expect(res.bandKcal).toBe(250);
      expect(res.method).toBe('ADAPTIVE');
      expect(res.estimatedExpenditure).toBeDefined();
    });

    it('trả về STABLE và HIGH confidence khi span >= 21 ngày và >= 10 ngày log, phần dư chuẩn <= 0.8kg', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        targetCalories: 2000,
      });
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 25);
      // Cân nặng mượt mà mỗi ngày trong 25 ngày
      const logs = Array.from({ length: 25 }, (_, i) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        return { id: String(i), date: d, weightKg: 70 - i * 0.05 };
      });
      prisma.weightLog.findMany.mockResolvedValue(logs);

      // 15 ngày ăn đầy đủ (mỗi ngày 2 bữa)
      const meals: { logDate: Date; totalCalories: number }[] = [];
      Array.from({ length: 15 }, (_, i) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        meals.push({ logDate: d, totalCalories: 1000 });
        meals.push({ logDate: d, totalCalories: 1000 });
      });
      prisma.meal.findMany.mockResolvedValue(meals);
      prisma.expenditureSnapshot.findFirst.mockResolvedValue({
        adaptiveExpenditure: 2100,
      });

      const res = await adaptiveService.recalculate('u1', 2000);
      expect(res.status).toBe('STABLE');
      expect(res.confidence).toBe('HIGH');
      expect(res.bandKcal).toBe(100);
      expect(res.todoList.length).toBe(0);
    });

    it('trả về STALE khi lần cân cuối đã quá 10 ngày trước', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        targetCalories: 2000,
      });
      // Lần cân cuối cách đây 14 ngày
      const baseDate = new Date();
      baseDate.setDate(baseDate.getDate() - 25);
      const logs = [0, 3, 6, 9, 11].map((dayOffset, i) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + dayOffset); // ngày cuối là baseDate + 11 = 14 ngày trước
        return { id: String(i), date: d, weightKg: 70 - i * 0.1 };
      });
      prisma.weightLog.findMany.mockResolvedValue(logs);

      const meals: { logDate: Date; totalCalories: number }[] = [];
      [0, 2, 4, 6, 8, 10].forEach((dayOffset) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + dayOffset);
        meals.push({ logDate: d, totalCalories: 1000 });
        meals.push({ logDate: d, totalCalories: 1000 });
      });
      prisma.meal.findMany.mockResolvedValue(meals);
      prisma.expenditureSnapshot.findFirst.mockResolvedValue(null);

      const res = await adaptiveService.recalculate('u1', 2000);
      expect(res.status).toBe('STALE');
      expect(res.message).toContain('quá 10 ngày chưa được cập nhật');
    });

    it('D4: recordSnapshot dùng upsert với snapshotDate tránh trùng lặp cùng ngày', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      await adaptiveService.recordSnapshot('u1', {
        estimatedExpenditure: 2200,
        staticTdee: 2000,
        status: 'STABLE',
      });

      expect(prisma.expenditureSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId_snapshotDate: expect.objectContaining({
              userId: 'u1',
            }),
          }),
        }),
      );
    });
  });
});
