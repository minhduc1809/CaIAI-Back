import { MealsService } from './meals.service';

const todayVn = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function build(user: any, mealTotals: number[]) {
  const meals = mealTotals.map((kcal, i) => ({
    id: `m${i}`,
    mealType: 'LUNCH',
    totalCalories: kcal,
    totalProtein: kcal / 20,
    totalCarb: kcal / 10,
    totalFat: kcal / 30,
    logDate: new Date(todayVn() + 'T00:00:00Z'),
    items: [],
  }));
  const notifications = { create: jest.fn() };
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', ...user })) },
    meal: { findMany: jest.fn(async () => meals) },
    dailyLogStatus: { findMany: jest.fn(async () => []) },
    workoutLog: { findMany: jest.fn(async () => []) },
    notification: { findFirst: jest.fn(async () => null) },
  };
  return { service: new MealsService(prisma, notifications as any), notifications };
}

const target = { targetCalories: 2000, targetProtein: 150, targetCarb: 220, targetFat: 60 };

describe('P1 Tổng hợp dinh dưỡng ngày', () => {
  it('chưa ghi gì: đã ăn 0, còn lại bằng mục tiêu, không vượt', async () => {
    const { service } = build(target, []);
    const res: any = await service.getDailyNutritionSummary('u1', todayVn());
    expect(res.data.summary).toMatchObject({
      consumedCalories: 0,
      targetCalories: 2000,
      remainingCalories: 2000,
      overCalories: 0,
      progressPercent: 0,
      hasTarget: true,
    });
  });

  it('ăn dưới mục tiêu: còn lại dương, tiến độ theo tỉ lệ', async () => {
    const { service } = build(target, [500, 700]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.consumedCalories).toBe(1200);
    expect(s.remainingCalories).toBe(800);
    expect(s.overCalories).toBe(0);
    expect(s.progressPercent).toBe(60);
  });

  it('ăn vượt mục tiêu: còn lại ÂM, có phần vượt, tiến độ kẹp 100', async () => {
    const { service } = build(target, [1200, 1100]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.consumedCalories).toBe(2300);
    expect(s.remainingCalories).toBe(-300);
    expect(s.overCalories).toBe(300);
    expect(s.progressPercent).toBe(100);
  });

  it('đúng bằng mục tiêu: không vượt', async () => {
    const { service } = build(target, [2000]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.remainingCalories).toBe(0);
    expect(s.overCalories).toBe(0);
  });

  it('chưa có mục tiêu: trả null, KHÔNG bịa 2000/150/200/60; đã ăn vẫn được cộng đúng', async () => {
    const { service } = build({ targetCalories: null, targetProtein: null, targetCarb: null, targetFat: null }, [450]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.hasTarget).toBe(false);
    expect(s.targetCalories).toBeNull();
    expect(s.remainingCalories).toBeNull();
    expect(s.progressPercent).toBeNull();
    expect(s.overCalories).toBe(0);
    expect(s.consumedCalories).toBe(450);
    expect(s.macros.protein.target).toBeNull();
    expect(s.macros.carb.target).toBeNull();
    expect(s.macros.fat.target).toBeNull();
  });

  it('mục tiêu bằng 0 được coi như chưa có mục tiêu, không chia cho 0', async () => {
    const { service } = build({ ...target, targetCalories: 0 }, [450]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.targetCalories).toBeNull();
    expect(s.progressPercent).toBeNull();
  });

  it('macro vượt mục tiêu vẫn trả số đã ăn thật, không kẹp', async () => {
    const { service } = build({ ...target, targetProtein: 20 }, [2000]);
    const s: any = (await service.getDailyNutritionSummary('u1', todayVn())).data.summary;
    expect(s.macros.protein.consumed).toBe(100);
    expect(s.macros.protein.target).toBe(20);
  });

  it('tóm tắt tuần: chưa có mục tiêu thì không có ngày nào "đạt mục tiêu"', async () => {
    const { service } = build({ targetCalories: null }, [1800]);
    const days: any = (await service.getWeekSummary('u1', todayVn())).data;
    expect(days.every((d: any) => d.metGoal === false)).toBe(true);
    expect(days[0].targetCalories).toBe(0);
  });
});

describe('P1 Thông báo hoàn thành ngày: không có mục tiêu thì không đánh giá', () => {
  it('chưa có mục tiêu → không gửi thông báo DAY_COMPLETED', async () => {
    const { service, notifications } = build({ targetCalories: null }, [1000, 1000]);
    await service.evaluateFinishedDay('u1', '2020-01-01');
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
