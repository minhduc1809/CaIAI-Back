import { UsersService } from './users.service';
import { HealthCalculatorService } from './health-calculator.service';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { getActiveGoal, startGoal } from './goal.util';

/** Bảng Goal giả trong bộ nhớ. */
function goalDb() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    goal: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows
          .filter((g) => g.userId === where.userId && g.status === where.status)
          .sort((a, b) => b.startDate - a.startDate)[0] ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = rows.filter((g) => g.userId === where.userId && g.status === where.status);
        hit.forEach((g) => Object.assign(g, data));
        return { count: hit.length };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `g${++seq}`, status: 'ACTIVE', endedAt: null, ...data };
        rows.push(row);
        return row;
      }),
    },
  };
}

describe('BR-09.5 Goal: một mục tiêu hiện hành, tiến độ tính từ lúc bắt đầu mục tiêu', () => {
  it('startGoal đóng Goal cũ và tạo Goal mới; chỉ có đúng một ACTIVE', async () => {
    const db = goalDb();
    await startGoal(db as any, 'u1', { goalType: 'LOSE_WEIGHT' as any, startWeight: 80, targetWeight: 70 });
    await startGoal(db as any, 'u1', { goalType: 'MAINTAIN' as any, startWeight: 72 });
    expect(db.rows).toHaveLength(2);
    expect(db.rows.filter((g) => g.status === 'ACTIVE')).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: 'ENDED' });
    expect(db.rows[0].endedAt).toBeInstanceOf(Date);
    expect((await getActiveGoal(db as any, 'u1'))!.goalType).toBe('MAINTAIN');
  });

  it('Goal của người này không ảnh hưởng người kia', async () => {
    const db = goalDb();
    await startGoal(db as any, 'u1', { goalType: 'LOSE_WEIGHT' as any, startWeight: 80 });
    await startGoal(db as any, 'u2', { goalType: 'GAIN_WEIGHT' as any, startWeight: 55 });
    expect(db.rows.filter((g) => g.status === 'ACTIVE')).toHaveLength(2);
  });
});

describe('Tiến độ cân nặng theo Goal', () => {
  function build(user: any) {
    const db = goalDb();
    const prisma: any = {
      ...db,
      user: { findUnique: jest.fn(async () => user) },
      weightLog: { findFirst: jest.fn(async () => ({ weightKg: 90, date: new Date('2025-01-01') })) },
    };
    return { service: new WeightLogsService(prisma, new HealthCalculatorService(), {} as any), db };
  }

  it('đổi mục tiêu thì tiến độ tính từ cân lúc đổi, không từ bản ghi cân của năm ngoái', async () => {
    // Năm ngoái 90 kg, giờ 70 kg và vừa chọn mục tiêu TĂNG cân về 75 kg (Goal mới bắt đầu ở 70)
    const { service, db } = build({ weightKg: 72.5, targetWeightKg: 75, goal: 'GAIN_WEIGHT' });
    await startGoal(db as any, 'u1', { goalType: 'GAIN_WEIGHT' as any, startWeight: 70, targetWeight: 75 });
    const res: any = await service.getWeightProgress('u1');
    expect(res.data.startWeightKg).toBe(70);
    expect(res.data.progressPercent).toBe(50); // 2,5 / 5 kg
  });

  it('chưa có Goal (người dùng cũ): dùng bản ghi cân sớm nhất như trước và tạo Goal để lần sau ổn định', async () => {
    const { service, db } = build({ weightKg: 85, targetWeightKg: 80, goal: 'LOSE_WEIGHT' });
    const res: any = await service.getWeightProgress('u1');
    expect(res.data.startWeightKg).toBe(90);
    expect(res.data.progressPercent).toBe(50); // 5 / 10 kg
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ status: 'ACTIVE', startWeight: 90, goalType: 'LOSE_WEIGHT' });
  });

  it('đi ngược hướng (đang giảm mà tăng cân) thì tiến độ 0, không âm', async () => {
    const { service, db } = build({ weightKg: 82, targetWeightKg: 75, goal: 'LOSE_WEIGHT' });
    await startGoal(db as any, 'u1', { goalType: 'LOSE_WEIGHT' as any, startWeight: 80, targetWeight: 75 });
    const res: any = await service.getWeightProgress('u1');
    expect(res.data.progressPercent).toBe(0);
  });

  it('vượt cân đích thì tiến độ tối đa 100%', async () => {
    const { service, db } = build({ weightKg: 70, targetWeightKg: 75, goal: 'LOSE_WEIGHT' });
    await startGoal(db as any, 'u1', { goalType: 'LOSE_WEIGHT' as any, startWeight: 80, targetWeight: 75 });
    const res: any = await service.getWeightProgress('u1');
    expect(res.data.progressPercent).toBe(100);
  });
});

describe('Hồ sơ → Goal', () => {
  function build(current: any) {
    const db = goalDb();
    const prisma: any = {
      ...db,
      user: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
      },
      weightLog: { create: jest.fn() },
      targetChange: { create: jest.fn(), findMany: jest.fn(async () => []) },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({ method: 'STATIC_FALLBACK', status: 'UPDATING', estimatedExpenditure: 2400, staticTdee: 2400, message: '' })),
      recordSnapshot: jest.fn(),
    };
    return { service: new UsersService(prisma, new HealthCalculatorService(), adaptive), db };
  }
  const base = {
    id: 'u1',
    heightCm: 170,
    weightKg: 80,
    targetWeightKg: 70,
    weightRateKgPerWeek: 0.5,
    bodyFatPercent: null,
    dateOfBirth: new Date('1995-01-01'),
    gender: 'MALE',
    activityLevel: 'MODERATELY_ACTIVE',
    goal: 'LOSE_WEIGHT',
    macroStyle: 'BALANCED',
    programType: 'MANUAL',
    targetCalories: 1800,
    targetProtein: 150,
    targetCarb: 200,
    targetFat: 60,
    adaptiveExpenditure: null,
  };

  it('hoàn tất Onboarding lần đầu (chưa có mục tiêu) tạo Goal đầu tiên', async () => {
    const { service, db } = build({ ...base, targetCalories: null, targetProtein: null, targetCarb: null, targetFat: null });
    await service.updateProfile('u1', { weightKg: 80 } as any);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ goalType: 'LOSE_WEIGHT', startWeight: 80, targetWeight: 70 });
  });

  it('đổi loại mục tiêu hoặc cân đích tạo Goal mới bắt đầu từ cân hiện tại', async () => {
    const { service, db } = build(base);
    await service.updateProfile('u1', { goal: 'MAINTAIN' } as any);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ goalType: 'MAINTAIN', startWeight: 80, status: 'ACTIVE' });
    await service.updateProfile('u1', { targetWeightKg: 65 } as any);
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0].status).toBe('ENDED');
    expect(db.rows[1].targetWeight).toBe(65);
  });

  it('chỉ đổi tốc độ, chiều cao hoặc tên thì KHÔNG tạo Goal mới', async () => {
    const { service, db } = build(base);
    await service.updateProfile('u1', { weightRateKgPerWeek: 0.75, heightCm: 172, name: 'An' } as any);
    expect(db.rows).toHaveLength(0);
  });
});
