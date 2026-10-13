import { NotificationType } from '@prisma/client';
import { WeightLogsService } from '../weight-logs/weight-logs.service';
import { WeeklySummaryService } from '../weekly-summary/weekly-summary.service';
import { MealsService } from '../meals/meals.service';
import { DailyStatusController } from '../daily-status/daily-status.controller';

describe('Bộ loại thông báo (BR-13.1)', () => {
  it('chỉ còn các loại do server tạo, đã bỏ các loại trái nguyên tắc hoặc là thông báo cục bộ', () => {
    expect(Object.keys(NotificationType).sort()).toEqual(
      [
        'BILLING_ISSUE',
        'CHECKIN_READY',
        'DAY_COMPLETED',
        'FOOD_SUBMISSION_RESULT',
        'GOAL_REACHED',
        'PAYMENT_SUCCESS',
        'WEEKLY_SUMMARY_READY',
      ].sort(),
    );
    for (const removed of ['GOAL_EXCEEDED', 'GOAL_ACHIEVED', 'AI_MESSAGE', 'MEAL_REMINDER', 'WATER_REMINDER']) {
      expect(Object.keys(NotificationType)).not.toContain(removed);
    }
  });
});

describe('GOAL_REACHED khi chạm cân đích', () => {
  function build(opts: { weight: number; goalType: string; target: number | null; notified?: boolean; claimCount?: number }) {
    const goal: any = {
      id: 'g1',
      goalType: opts.goalType,
      targetWeight: opts.target,
      status: 'ACTIVE',
      reachedNotifiedAt: opts.notified ? new Date() : null,
    };
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ weightKg: opts.weight })) },
      goal: {
        findFirst: jest.fn(async () => goal),
        updateMany: jest.fn(async () => ({ count: opts.claimCount ?? 1 })),
      },
    };
    const notifications: any = { create: jest.fn(async () => ({})) };
    const service = new WeightLogsService(prisma, {} as any, {} as any, notifications);
    return { service, prisma, notifications };
  }

  it('giảm cân: cân ≤ cân đích → báo một lần, kèm gợi ý chuyển sang Duy trì', async () => {
    const { service, notifications, prisma } = build({ weight: 64.8, goalType: 'LOSE_WEIGHT', target: 65 });
    await service.notifyGoalReachedIfNeeded('u1');
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const [, type, , message] = notifications.create.mock.calls[0];
    expect(type).toBe('GOAL_REACHED');
    expect(message).toMatch(/Duy trì/);
    expect(prisma.goal.updateMany.mock.calls[0][0].where).toEqual({ id: 'g1', reachedNotifiedAt: null });
  });

  it('tăng cân: cân ≥ cân đích → báo', async () => {
    const { service, notifications } = build({ weight: 70, goalType: 'GAIN_WEIGHT', target: 70 });
    await service.notifyGoalReachedIfNeeded('u1');
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('chưa tới cân đích thì không báo', async () => {
    const a = build({ weight: 66, goalType: 'LOSE_WEIGHT', target: 65 });
    await a.service.notifyGoalReachedIfNeeded('u1');
    expect(a.notifications.create).not.toHaveBeenCalled();
    const b = build({ weight: 69, goalType: 'GAIN_WEIGHT', target: 70 });
    await b.service.notifyGoalReachedIfNeeded('u1');
    expect(b.notifications.create).not.toHaveBeenCalled();
  });

  it('đã báo cho Goal này rồi thì không báo lại', async () => {
    const { service, notifications } = build({ weight: 60, goalType: 'LOSE_WEIGHT', target: 65, notified: true });
    await service.notifyGoalReachedIfNeeded('u1');
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('hai request đồng thời: chỉ request giành được cờ mới gửi thông báo', async () => {
    const { service, notifications } = build({ weight: 60, goalType: 'LOSE_WEIGHT', target: 65, claimCount: 0 });
    await service.notifyGoalReachedIfNeeded('u1');
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('duy trì cân hoặc không có cân đích: không báo', async () => {
    const a = build({ weight: 70, goalType: 'MAINTAIN', target: 70 });
    await a.service.notifyGoalReachedIfNeeded('u1');
    expect(a.notifications.create).not.toHaveBeenCalled();
    const b = build({ weight: 60, goalType: 'LOSE_WEIGHT', target: null });
    await b.service.notifyGoalReachedIfNeeded('u1');
    expect(b.notifications.create).not.toHaveBeenCalled();
  });

  it('lỗi khi báo không làm hỏng ghi cân; thiếu dịch vụ thông báo cũng không lỗi', async () => {
    const { service, notifications } = build({ weight: 60, goalType: 'LOSE_WEIGHT', target: 65 });
    notifications.create.mockRejectedValueOnce(new Error('boom'));
    await expect(service.notifyGoalReachedIfNeeded('u1')).resolves.toBeUndefined();
    const bare = new WeightLogsService({} as any, {} as any, {} as any);
    await expect(bare.notifyGoalReachedIfNeeded('u1')).resolves.toBeUndefined();
  });
});

describe('WEEKLY_SUMMARY_READY khi tổng kết tuần được tạo', () => {
  function build(opts: { cached: boolean; avgCalories?: number | null }) {
    const prisma: any = {
      weeklySummary: { findUnique: jest.fn(async () => (opts.cached ? { id: 's' } : null)) },
    };
    const notifications: any = { create: jest.fn(async () => ({})) };
    const service: any = new WeeklySummaryService({ get: () => undefined } as any, prisma, {} as any, notifications);
    service.getCurrentWeekRange = jest.fn(async () => ({ weekStartDate: new Date(), weekEndDate: new Date() }));
    const dto = { avgCalories: opts.avgCalories === undefined ? 2000 : opts.avgCalories };
    service.generateWeeklySummary = jest.fn(async () => dto);
    service.toDto = jest.fn(() => dto);
    service.applyTier = jest.fn(async (_u: string, dto: any) => dto);
    return { service, notifications };
  }

  it('tổng kết mới tạo → có thông báo', async () => {
    const { service, notifications } = build({ cached: false });
    await service.getWeeklySummary('u1');
    expect(notifications.create).toHaveBeenCalledWith('u1', 'WEEKLY_SUMMARY_READY', expect.any(String), expect.any(String));
  });

  it('tổng kết chưa có dữ liệu thật (tài khoản mới) → không báo', async () => {
    const { service, notifications } = build({ cached: false, avgCalories: null });
    await service.getWeeklySummary('u1');
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('mở lại tổng kết đã có → không báo lại', async () => {
    const { service, notifications } = build({ cached: true });
    await service.getWeeklySummary('u1');
    expect(notifications.create).not.toHaveBeenCalled();
  });
});

describe('GET không còn tác dụng phụ; đánh giá ngày hôm qua là thao tác riêng', () => {
  it('POST daily-status/evaluate đánh giá ngày hôm qua theo múi giờ người dùng', async () => {
    const prisma: any = { user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) } };
    const meals: any = Object.create(MealsService.prototype);
    meals.prisma = prisma;
    meals.evaluateFinishedDay = jest.fn(async () => undefined);
    const controller = new DailyStatusController({} as any, meals);
    const res = await controller.evaluate('u1');
    expect(res.evaluated).toBe(true);
    expect(meals.evaluateFinishedDay).toHaveBeenCalledWith('u1', res.date);
  });

  it('lỗi đánh giá không làm hỏng việc mở app', async () => {
    const meals: any = Object.create(MealsService.prototype);
    meals.prisma = { user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) } };
    meals.evaluateFinishedDay = jest.fn(async () => {
      throw new Error('db');
    });
    const res = await new DailyStatusController({} as any, meals).evaluate('u1');
    expect(res.evaluated).toBe(false);
  });
});
