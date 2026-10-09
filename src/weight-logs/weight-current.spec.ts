import { WeightLogsService } from './weight-logs.service';
import { HealthCalculatorService } from '../users/health-calculator.service';

const DAY = 24 * 3600 * 1000;

/** Bộ nhớ giả cho WeightLog + User, đủ cho các thao tác WeightLogsService dùng. */
function build(initialWeight = 70) {
  let seq = 0;
  const logs: any[] = [];
  const user: any = {
    id: 'u1',
    weightKg: initialWeight,
    heightCm: 170,
    gender: 'MALE',
    dateOfBirth: new Date('1995-01-01'),
    activityLevel: 'MODERATELY_ACTIVE',
    goal: 'MAINTAIN',
    macroStyle: 'BALANCED',
    targetWeightKg: null,
    weightRateKgPerWeek: 0.5,
    bodyFatPercent: null,
    targetCalories: 2200,
  };
  const newestFirst = (a: any, b: any) =>
    b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime();

  const prisma: any = {
    weightLog: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `w${++seq}`, ...data, createdAt: new Date(Date.now() + seq) };
        logs.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => logs.find((l) => l.id === where.id) ?? null),
      findFirst: jest.fn(async () => [...logs].sort(newestFirst)[0] ?? null),
      findMany: jest.fn(async ({ take }: any) => [...logs].sort(newestFirst).slice(0, take)),
      update: jest.fn(async ({ where, data }: any) => {
        const row = logs.find((l) => l.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        logs.splice(logs.findIndex((l) => l.id === where.id), 1);
      }),
    },
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
    },
  };
  const adaptive: any = {
    recalculate: jest.fn(async () => ({ estimatedExpenditure: 2500, status: 'UPDATING' })),
    recordSnapshot: jest.fn(),
  };
  const service = new WeightLogsService(prisma, new HealthCalculatorService(), adaptive);
  return { service, user, logs, prisma, adaptive };
}

describe('BR-09 Cân nặng hiện tại luôn là bản ghi mới nhất theo ngày', () => {
  it('ghi bù một lần cân của tuần trước KHÔNG ghi đè cân hiện tại', async () => {
    const { service, user } = build();
    await service.createLog('u1', { weightKg: 70, date: new Date(Date.now() - 1 * DAY).toISOString() } as any);
    expect(user.weightKg).toBe(70);
    await service.createLog('u1', { weightKg: 72, date: new Date(Date.now() - 10 * DAY).toISOString() } as any);
    expect(user.weightKg).toBe(70); // trước đây bị đè thành 72
  });

  it('ghi cân hôm nay thì cân hiện tại và BMI được cập nhật', async () => {
    const { service, user } = build();
    await service.createLog('u1', { weightKg: 68.5, date: new Date().toISOString() } as any);
    expect(user.weightKg).toBe(68.5);
    expect(user.bmi).toBeCloseTo(68.5 / (1.7 * 1.7), 0);
  });

  it('sửa bản ghi mới nhất thì cân hiện tại đổi theo', async () => {
    const { service, user } = build();
    const a: any = await service.createLog('u1', { weightKg: 70, date: new Date(Date.now() - 2 * DAY).toISOString() } as any);
    const b: any = await service.createLog('u1', { weightKg: 69, date: new Date().toISOString() } as any);
    expect(user.weightKg).toBe(69);
    await service.updateLog('u1', b.data.id, { weightKg: 71 } as any);
    expect(user.weightKg).toBe(71);
    // sửa bản ghi cũ không làm thay đổi cân hiện tại
    await service.updateLog('u1', a.data.id, { weightKg: 66 } as any);
    expect(user.weightKg).toBe(71);
  });

  it('xoá bản ghi mới nhất thì cân hiện tại quay về bản ghi trước đó', async () => {
    const { service, user } = build();
    await service.createLog('u1', { weightKg: 70, date: new Date(Date.now() - 2 * DAY).toISOString() } as any);
    const b: any = await service.createLog('u1', { weightKg: 75, date: new Date().toISOString() } as any);
    expect(user.weightKg).toBe(75);
    await service.deleteLog('u1', b.data.id);
    expect(user.weightKg).toBe(70);
  });

  it('xoá bản ghi cuối cùng thì giữ nguyên cân hiện tại đã biết, không về 0 hay null', async () => {
    const { service, user } = build(70);
    const a: any = await service.createLog('u1', { weightKg: 69, date: new Date().toISOString() } as any);
    await service.deleteLog('u1', a.data.id);
    expect(user.weightKg).toBe(69);
  });

  it('hai lần cân cùng ngày: lần nhập sau là cân hiện tại', async () => {
    const { service, user } = build();
    const day = new Date().toISOString().slice(0, 10);
    await service.createLog('u1', { weightKg: 70, date: day } as any);
    await service.createLog('u1', { weightKg: 69.4, date: day } as any);
    expect(user.weightKg).toBe(69.4);
  });

  it('thêm, sửa, xoá đều KHÔNG đổi mục tiêu calo', async () => {
    const { service, user } = build();
    const a: any = await service.createLog('u1', { weightKg: 70, date: new Date().toISOString() } as any);
    await service.updateLog('u1', a.data.id, { weightKg: 71 } as any);
    await service.deleteLog('u1', a.data.id);
    expect(user.targetCalories).toBe(2200);
  });

  it('có hơn `limit` bản ghi: lịch sử trả về các lần cân GẦN NHẤT theo thứ tự cũ → mới', async () => {
    const { service } = build();
    for (let i = 0; i < 40; i++) {
      await service.createLog('u1', { weightKg: 70 + i * 0.1, date: new Date(Date.now() - (40 - i) * DAY).toISOString() } as any);
    }
    const res: any = await service.getLogs('u1', 30);
    expect(res.data).toHaveLength(30);
    expect(res.data[0].weightKg).toBeCloseTo(70 + 10 * 0.1, 5); // bản ghi thứ 11
    expect(res.data[29].weightKg).toBeCloseTo(70 + 39 * 0.1, 5); // bản ghi mới nhất
  });
});
