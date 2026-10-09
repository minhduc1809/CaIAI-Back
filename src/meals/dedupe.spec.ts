import { MealsService } from './meals.service';

const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function build() {
  const meals: any[] = [];
  let seq = 0;
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    meal: {
      create: jest.fn(async ({ data }: any) => {
        if (data.dedupeKey && meals.some((m) => m.userId === data.userId && m.dedupeKey === data.dedupeKey)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: `m${++seq}`, ...data, items: data.items?.create ?? [] };
        meals.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        meals.find((m) => m.userId === where.userId && m.dedupeKey === where.dedupeKey) ?? null,
      ),
    },
  };
  return { service: new MealsService(prisma, { create: jest.fn() } as any), meals };
}

const meal = (over: any = {}) => ({
  mealType: 'LUNCH',
  date: today(),
  items: [{ name: 'Cơm', quantity: 1, calories: 200, protein: 4, carb: 45, fat: 1 }],
  ...over,
});

describe('P1 Chống ghi trùng bữa ăn', () => {
  it('bấm đúp / gửi lại cùng nội dung: chỉ một bữa, lần sau trả lại đúng bữa đã có', async () => {
    const { service, meals } = build();
    const first: any = await service.createMeal('u1', meal() as any);
    const second: any = await service.createMeal('u1', meal() as any);
    expect(meals).toHaveLength(1);
    expect(second.data.id).toBe(first.data.id);
    expect(second.message).toContain('đã được ghi nhận');
  });

  it('gửi đồng thời hai yêu cầu giống nhau vẫn chỉ ra một bữa', async () => {
    const { service, meals } = build();
    const [a, b]: any[] = await Promise.all([service.createMeal('u1', meal() as any), service.createMeal('u1', meal() as any)]);
    expect(meals).toHaveLength(1);
    expect(a.data.id).toBe(b.data.id);
  });

  it('nội dung khác (số lượng, món, loại bữa, ngày) thì là bữa khác', async () => {
    const { service, meals } = build();
    await service.createMeal('u1', meal() as any);
    await service.createMeal('u1', meal({ items: [{ name: 'Cơm', quantity: 2, calories: 200 }] }) as any);
    await service.createMeal('u1', meal({ mealType: 'DINNER' }) as any);
    await service.createMeal('u1', meal({ items: [{ name: 'Phở', quantity: 1, calories: 450 }] }) as any);
    expect(meals).toHaveLength(4);
  });

  it('hai người dùng ghi cùng nội dung không chặn nhau', async () => {
    const { service, meals } = build();
    await service.createMeal('u1', meal() as any);
    await service.createMeal('u2', meal() as any);
    expect(meals).toHaveLength(2);
  });

  it('sau khung 2 phút, ghi lại cùng nội dung là bữa mới (ăn lại thật)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    try {
      const { service, meals } = build();
      jest.setSystemTime(new Date('2026-10-08T05:00:10Z'));
      await service.createMeal('u1', meal({ date: '2026-10-08' }) as any);
      jest.setSystemTime(new Date('2026-10-08T05:03:10Z'));
      await service.createMeal('u1', meal({ date: '2026-10-08' }) as any);
      expect(meals).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ghi nhanh cũng chống trùng', async () => {
    const { service, meals } = build();
    const q = { name: 'Phở ngoài', mealType: 'DINNER', date: today(), calories: 600 };
    await service.quickAddMeal('u1', q as any);
    await service.quickAddMeal('u1', q as any);
    expect(meals).toHaveLength(1);
  });

  it('lỗi khác (không phải trùng khoá) vẫn được báo ra, không bị nuốt', async () => {
    const { service } = build();
    (service as any).prisma.meal.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(service.createMeal('u1', meal() as any)).rejects.toThrow('DB down');
  });
});
