import { CheckinsService } from './checkins.service';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { addDaysToKey, mondayOnOrBefore, todayKey } from '../common/utils/date-zone.util';

/**
 * BR-06.4: macro đề xuất = công thức của hồ sơ (đạm g/kg, chia béo/tinh bột theo phong cách) với calo đề xuất.
 * Không đổi calo thì không được âm thầm đổi macro. weekNumber tính theo tuổi tài khoản, không theo epoch.
 */
async function generate(opts: {
  target: number;
  expenditure: number;
  macros?: { protein: number; carb: number; fat: number };
  createdAt?: Date;
  style?: string;
  adaptive?: boolean;
}) {
  const macros = opts.macros ?? { protein: 112, carb: 291, fat: 105 };
  const user = {
    id: 'u1',
    createdAt: opts.createdAt ?? new Date('2026-08-24T00:00:00.000Z'),
    goal: 'MAINTAIN',
    gender: 'MALE',
    heightCm: 175,
    weightKg: 70,
    bodyFatPercent: null,
    proteinPreference: 'MID',
    macroStyle: opts.style ?? 'BALANCED',
    targetCalories: opts.target,
    targetProtein: macros.protein,
    targetCarb: macros.carb,
    targetFat: macros.fat,
    tdee: opts.expenditure,
    adaptiveExpenditure: opts.expenditure,
    weightRateKgPerWeek: 0.5,
    targetWeightKg: null,
  };
  const prisma: any = {
    user: { findUnique: jest.fn(async () => user) },
    meal: { findMany: jest.fn(async () => []) },
    weightLog: { findMany: jest.fn(async () => [{ weightKg: 70, date: new Date() }]) },
    dailyLogStatus: { findMany: jest.fn(async () => []) },
    checkIn: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ id: 'c1', ...args.data })),
    },
  };
  const expenditure: any = {
    recalculate: jest.fn(async () => ({
      estimatedExpenditure: opts.expenditure,
      method: opts.adaptive === false ? 'STATIC' : 'ADAPTIVE',
      status: 'STABLE',
    })),
  };
  const weights: any = { getWeightProgress: jest.fn(async () => ({ data: { progressPercent: 10 } })) };
  const service = new CheckinsService(prisma, expenditure, new HealthCalculatorService(), weights, {
    create: jest.fn(),
  } as any);
  const res: any = await service.generateCheckin('u1', {});
  return { data: prisma.checkIn.create.mock.calls[0][0].data, res };
}

describe('Macro đề xuất của Check-in dùng công thức hồ sơ', () => {
  it('không đổi calo → giữ nguyên macro hiện tại (không đổi đạm 112 g thành 30% calo)', async () => {
    // MAINTAIN, cân đích trống: ideal = Expenditure = mục tiêu hiện tại
    const { data } = await generate({ target: 2556, expenditure: 2556 });
    expect(data.proposedCalorieTarget).toBe(2556);
    expect(data.proposedProteinTarget).toBe(112);
    expect(data.proposedCarbTarget).toBe(291);
    expect(data.proposedFatTarget).toBe(105);
  });

  it('đổi calo → đạm vẫn theo g/kg (70 kg × 1,6 = 112 g), phần còn lại chia theo phong cách', async () => {
    const { data } = await generate({ target: 2000, expenditure: 2100 });
    expect(data.proposedCalorieTarget).toBe(2100);
    expect(data.proposedProteinTarget).toBe(112);
    const kcal = data.proposedProteinTarget * 4 + data.proposedCarbTarget * 4 + data.proposedFatTarget * 9;
    expect(Math.abs(kcal - 2100)).toBeLessThanOrEqual(3);
    // BALANCED chia 55:45 trên phần còn lại sau đạm, béo không dưới sàn
    expect(data.proposedFatTarget).toBeGreaterThanOrEqual(45);
  });

  it('phong cách ít béo: macro đề xuất tôn trọng sàn béo tối thiểu', async () => {
    const { data } = await generate({ target: 2000, expenditure: 2100, style: 'HIGH_CARB_LOW_FAT' });
    expect(data.proposedFatTarget).toBeGreaterThanOrEqual(45);
  });

  it('thiếu dữ liệu (engine tĩnh): đề xuất = mục tiêu hiện tại, kể cả macro', async () => {
    const { data } = await generate({ target: 2556, expenditure: 2556, adaptive: false });
    expect(data.status).toBe('INSUFFICIENT_DATA');
    expect(data.proposedProteinTarget).toBe(112);
    expect(data.proposedCarbTarget).toBe(291);
    expect(data.proposedFatTarget).toBe(105);
  });

  it('macro hiện tại trả về là mục tiêu thật của user', async () => {
    const { res } = await generate({ target: 2556, expenditure: 2556, macros: { protein: 130, carb: 250, fat: 90 } });
    expect(res.data.currentMacros).toEqual({ protein: 130, carb: 250, fat: 90 });
  });
});

describe('Số tuần của Check-in', () => {
  it('tính theo tuổi tài khoản, không phải số tuần kể từ năm 1970', async () => {
    const { data } = await generate({
      target: 2556,
      expenditure: 2556,
      createdAt: new Date(Date.now() - 20 * 24 * 3_600_000),
    });
    expect(data.weekNumber).toBeGreaterThanOrEqual(1);
    expect(data.weekNumber).toBeLessThan(10);
  });

  it('tài khoản tạo đúng đầu kỳ dữ liệu là tuần 1', async () => {
    // kỳ dữ liệu = 7 ngày trước Thứ Hai gần nhất; tài khoản tạo đúng ngày đầu kỳ thì Check-in đầu tiên là tuần 1
    const startKey = addDaysToKey(mondayOnOrBefore(todayKey('Asia/Ho_Chi_Minh')), -7);
    const { data } = await generate({
      target: 2556,
      expenditure: 2556,
      createdAt: new Date(startKey + 'T01:00:00.000Z'),
    });
    expect(data.weekNumber).toBe(1);
  });
});
