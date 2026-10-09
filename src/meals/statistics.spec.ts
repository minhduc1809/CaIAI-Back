import { MealsService } from './meals.service';

const d = (key: string) => new Date(`${key}T00:00:00Z`);
const meal = (key: string, kcal: number) => ({
  logDate: d(key),
  totalCalories: kcal,
  totalProtein: kcal / 20,
  totalCarb: kcal / 10,
  totalFat: kcal / 30,
});

function build(meals: any[], flags: { logDate: Date; completeness: string }[] = [], targetCalories: number | null = 2000) {
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', targetCalories })) },
    meal: { findMany: jest.fn(async () => meals), findFirst: jest.fn(async () => meals[0] ?? null) },
    dailyLogStatus: { findMany: jest.fn(async () => flags) },
  };
  return new MealsService(prisma, { create: jest.fn() } as any);
}

const range = ['2026-09-01', '2026-09-07'] as const;

describe('P1 Thống kê: trung bình chỉ tính trên ngày ghi đầy đủ', () => {
  it('ngày chỉ ghi một ly nước cam không kéo trung bình xuống', async () => {
    const service = build([
      meal('2026-09-01', 900), meal('2026-09-01', 900), // 1800, 2 bữa → đủ
      meal('2026-09-02', 150), // 1 bữa → chưa đủ
      meal('2026-09-03', 1100), meal('2026-09-03', 1100), meal('2026-09-03', 0), // 2200, 3 bữa → đủ
    ]);
    const res: any = (await service.getNutritionStatistics('u1', range[0], range[1])).data;
    expect(res.loggedDays).toBe(3);
    expect(res.completeDays).toBe(2);
    expect(res.averages.dailyCalories).toBe(2000); // (1800 + 2200) / 2, không phải (1800 + 150 + 2200) / 3
    expect(res.dailyStats.map((x: any) => x.isComplete)).toEqual([true, false, true]);
  });

  it('chưa có ngày đầy đủ nào: trung bình = 0 và completeDays = 0 để app báo "chưa đủ dữ liệu"', async () => {
    const service = build([meal('2026-09-02', 300)]);
    const res: any = (await service.getNutritionStatistics('u1', range[0], range[1])).data;
    expect(res.loggedDays).toBe(1);
    expect(res.completeDays).toBe(0);
    expect(res.averages.dailyCalories).toBe(0);
  });

  it('không ghi gì: 0 ngày, không chia cho 0', async () => {
    const service = build([]);
    const res: any = (await service.getNutritionStatistics('u1', range[0], range[1])).data;
    expect(res.loggedDays).toBe(0);
    expect(res.completeDays).toBe(0);
    expect(res.averages.dailyCalories).toBe(0);
  });

  it('người dùng đánh dấu "Đã ghi đủ" thì ngày ít bữa vẫn được tính; "Ghi chưa đủ" thì bị loại', async () => {
    const service = build(
      [
        meal('2026-09-01', 1500), // 1 bữa nhưng người dùng xác nhận đủ
        meal('2026-09-02', 1000), meal('2026-09-02', 1000), // 2 bữa nhưng người dùng đánh dấu chưa đủ
      ],
      [
        { logDate: d('2026-09-01'), completeness: 'COMPLETE' },
        { logDate: d('2026-09-02'), completeness: 'INCOMPLETE' },
      ],
    );
    const res: any = (await service.getNutritionStatistics('u1', range[0], range[1])).data;
    expect(res.completeDays).toBe(1);
    expect(res.averages.dailyCalories).toBe(1500);
  });

  it('cùng quy tắc với tóm tắt tuần: một ngày đủ ở thống kê thì cũng đủ ở week-summary', async () => {
    const meals = [meal('2026-09-01', 900), meal('2026-09-01', 900), meal('2026-09-02', 150)];
    const service = build(meals);
    const stats: any = (await service.getNutritionStatistics('u1', range[0], range[1])).data;
    const week: any = (await service.getWeekSummary('u1', range[0])).data;
    for (const day of stats.dailyStats) {
      expect(week.find((w: any) => w.date === day.date).isComplete).toBe(day.isComplete);
    }
  });
});
