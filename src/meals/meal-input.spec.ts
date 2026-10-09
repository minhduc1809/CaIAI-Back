import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MealsService } from './meals.service';
import { CreateMealDto } from './dto/create-meal.dto';
import { QuickAddMealDto } from './dto/quick-add-meal.dto';
import { UpdateMealDto } from './dto/update-meal.dto';
import { IsNotFutureDate } from '../common/validators/not-future-date.validator';
import { IsOptional } from 'class-validator';

// Giống cấu hình trong main.ts
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (value: any, metatype: any) => pipe.transform(value, { type: 'body', metatype });

const DAY = 24 * 3600 * 1000;
const dayKey = (offsetDays = 0, tzOffsetHours = 7) =>
  new Date(Date.now() + tzOffsetHours * 3600 * 1000 + offsetDays * DAY).toISOString().slice(0, 10);

const okItem = { name: 'Cơm', calories: 200, protein: 4, carb: 45, fat: 1, quantity: 1 };
const okMeal = (over: any = {}) => ({ mealType: 'LUNCH', date: dayKey(), items: [okItem], ...over });

describe('P0 Ghi bữa ăn: giới hạn số liệu do app gửi lên', () => {
  it('bữa hợp lệ đi qua', async () => {
    await expect(validate(okMeal(), CreateMealDto)).resolves.toBeDefined();
  });

  it.each([
    ['calo một phần vượt 5000', { ...okItem, calories: 5001 }],
    ['calo là một con số khổng lồ', { ...okItem, calories: 9_999_999 }],
    ['protein vượt 500 g', { ...okItem, protein: 501 }],
    ['carb vượt 500 g', { ...okItem, carb: 501 }],
    ['fat vượt 500 g', { ...okItem, fat: 501 }],
    ['số lượng vượt 50', { ...okItem, quantity: 51 }],
    ['số lượng dưới 0,1', { ...okItem, quantity: 0.05 }],
    ['khẩu phần vượt 10.000', { ...okItem, servingAmount: 10001 }],
    ['calo âm', { ...okItem, calories: -1 }],
    ['tên món quá dài', { ...okItem, name: 'x'.repeat(201) }],
  ])('từ chối: %s', async (_label, item) => {
    await expect(validate(okMeal({ items: [item] }), CreateMealDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('biên cho phép: 5000 kcal, 500 g, số lượng 50 vẫn hợp lệ ở mức DTO', async () => {
    await expect(
      validate(okMeal({ items: [{ ...okItem, calories: 5000, protein: 500, carb: 500, fat: 500, quantity: 50 }] }), CreateMealDto),
    ).resolves.toBeDefined();
  });

  it('bữa không món hoặc hơn 50 món bị từ chối', async () => {
    await expect(validate(okMeal({ items: [] }), CreateMealDto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate(okMeal({ items: Array.from({ length: 51 }, () => okItem) }), CreateMealDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ghi nhanh: calo vượt 10.000 hoặc macro vượt 1000 g bị từ chối', async () => {
    const quick = { name: 'Bữa ngoài', mealType: 'DINNER', date: dayKey(), calories: 600 };
    await expect(validate(quick, QuickAddMealDto)).resolves.toBeDefined();
    await expect(validate({ ...quick, calories: 10001 }, QuickAddMealDto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...quick, protein: 1001 }, QuickAddMealDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sửa bữa: hơn 50 món bị từ chối nhưng danh sách rỗng (xoá bữa) vẫn hợp lệ ở mức DTO', async () => {
    await expect(validate({ items: [] }, UpdateMealDto)).resolves.toBeDefined();
    await expect(
      validate({ items: Array.from({ length: 51 }, () => okItem) }, UpdateMealDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** Bộ nhớ giả cho Meal/MealItem, đủ cho các thao tác ghi. */
function build(timezone = 'Asia/Ho_Chi_Minh') {
  const meals: any[] = [];
  const state = { failOnMealUpdate: false };
  let seq = 0;
  const makeTx = (store: any[]) => ({
    mealItem: {
      deleteMany: jest.fn(async ({ where }: any) => {
        const m = store.find((x) => x.id === where.mealId);
        if (m) m.items = [];
      }),
      createMany: jest.fn(async ({ data }: any) => {
        const m = store.find((x) => x.id === data[0].mealId);
        m.items = data.map((d: any) => ({ ...d }));
      }),
    },
    meal: {
      update: jest.fn(async ({ where, data }: any) => {
        if (state.failOnMealUpdate) throw new Error('DB down');
        const m = store.find((x) => x.id === where.id);
        Object.assign(m, data);
        return { ...m, items: m.items };
      }),
    },
  });
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ timezone })) },
    meal: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `m${++seq}`, ...data, items: data.items.create };
        meals.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => meals.find((m) => m.id === where.id) ?? null),
      delete: jest.fn(async ({ where }: any) => {
        meals.splice(meals.findIndex((m) => m.id === where.id), 1);
      }),
    },
    // Transaction giả: nếu callback ném lỗi thì khôi phục lại trạng thái trước đó
    $transaction: jest.fn(async (cb: any) => {
      const snapshot = JSON.parse(JSON.stringify(meals));
      try {
        return await cb(makeTx(meals));
      } catch (e) {
        meals.splice(0, meals.length, ...snapshot);
        throw e;
      }
    }),
  };
  const service = new MealsService(prisma, { create: jest.fn() } as any);
  return { service, meals, state };
}

describe('P0 Ghi bữa ăn: ngày tương lai và tổng hợp lý (service)', () => {
  it('ghi bữa cho ngày hôm nay và quá khứ thì được', async () => {
    const { service } = build();
    await expect(service.createMeal('u1', okMeal() as any)).resolves.toBeDefined();
    await expect(service.createMeal('u1', okMeal({ date: dayKey(-3) }) as any)).resolves.toBeDefined();
  });

  it('ghi bữa cho ngày mai theo múi giờ của user bị từ chối', async () => {
    const { service, meals } = build();
    await expect(service.createMeal('u1', okMeal({ date: dayKey(1) }) as any)).rejects.toThrow('tương lai');
    expect(meals).toHaveLength(0);
  });

  it('múi giờ Việt Nam: "hôm nay" của user có thể đã sang ngày mới so với UTC mà vẫn được ghi', async () => {
    const { service } = build('Asia/Ho_Chi_Minh');
    await expect(service.createMeal('u1', okMeal({ date: dayKey(0, 7) }) as any)).resolves.toBeDefined();
  });

  it('ghi nhanh và sao chép sang ngày tương lai cũng bị từ chối', async () => {
    const { service } = build();
    await expect(
      service.quickAddMeal('u1', { name: 'x', mealType: 'SNACK', date: dayKey(2), calories: 100 } as any),
    ).rejects.toThrow('tương lai');
    const created: any = await service.createMeal('u1', okMeal() as any);
    await expect(service.copyMeal('u1', created.data.id, { targetDate: dayKey(2) } as any)).rejects.toThrow('tương lai');
  });

  it('một món thành 10.001 kcal sau khi nhân số lượng thì bị từ chối', async () => {
    const { service, meals } = build();
    await expect(
      service.createMeal('u1', okMeal({ items: [{ ...okItem, calories: 4000, quantity: 3 }] }) as any),
    ).rejects.toThrow('một món');
    expect(meals).toHaveLength(0);
  });

  it('tổng một bữa vượt 15.000 kcal bị từ chối dù từng món đều hợp lệ', async () => {
    const { service } = build();
    const items = Array.from({ length: 4 }, () => ({ ...okItem, calories: 4000, quantity: 1 }));
    await expect(service.createMeal('u1', okMeal({ items }) as any)).rejects.toThrow('Tổng calo');
  });

  it('tổng calo/macro được tính đúng: calo của món nhân với số lượng', async () => {
    const { service } = build();
    const res: any = await service.createMeal(
      'u1',
      okMeal({ items: [{ name: 'Trứng', calories: 70, protein: 6, carb: 0.5, fat: 5, quantity: 3 }, okItem] }) as any,
    );
    expect(res.data.totalCalories).toBe(410); // 70*3 + 200
    expect(res.data.totalProtein).toBe(22); // 6*3 + 4
  });
});

describe('P0 Sửa bữa ăn: một transaction', () => {
  it('thay món thì tổng được cập nhật cùng lúc', async () => {
    const { service } = build();
    const created: any = await service.createMeal('u1', { ...okMeal(), userId: 'u1' } as any);
    const res: any = await service.updateMeal('u1', created.data.id, {
      items: [{ name: 'Phở', calories: 450, protein: 25, carb: 60, fat: 10, quantity: 1 }],
    } as any);
    expect(res.data.totalCalories).toBe(450);
    expect(res.data.items).toHaveLength(1);
  });

  it('lỗi ở bước cập nhật bữa thì món cũ và tổng cũ được giữ nguyên, không bị nửa vời', async () => {
    const { service, meals, state } = build();
    const created: any = await service.createMeal('u1', okMeal() as any);
    meals[0].userId = 'u1';
    state.failOnMealUpdate = true;
    await expect(
      service.updateMeal('u1', created.data.id, {
        items: [{ name: 'Phở', calories: 450, quantity: 1 }],
      } as any),
    ).rejects.toThrow('DB down');
    expect(meals[0].items).toHaveLength(1);
    expect(meals[0].items[0].name).toBe('Cơm');
    expect(meals[0].totalCalories).toBe(200);
  });

  it('đổi bữa sang ngày tương lai bị từ chối', async () => {
    const { service, meals } = build();
    const created: any = await service.createMeal('u1', okMeal() as any);
    meals[0].userId = 'u1';
    await expect(service.updateMeal('u1', created.data.id, { date: dayKey(3) } as any)).rejects.toThrow('tương lai');
  });

  it('xoá hết món (items = []) xoá cả bữa', async () => {
    const { service, meals } = build();
    const created: any = await service.createMeal('u1', okMeal() as any);
    meals[0].userId = 'u1';
    await service.updateMeal('u1', created.data.id, { items: [] } as any);
    expect(meals).toHaveLength(0);
  });
});

describe('Validator ngày không tương lai: chuỗi chỉ có ngày', () => {
  class Dto {
    @IsOptional()
    @IsNotFutureDate()
    date?: string;
  }
  it('"hôm nay" của người dùng ở UTC+7 không bị từ chối nhầm; ngày mai và xa hơn vẫn bị từ chối', async () => {
    await expect(validate({ date: dayKey(0, 7) }, Dto)).resolves.toBeDefined();
    await expect(validate({ date: dayKey(2, 0) }, Dto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ date: new Date(Date.now() + 7 * DAY).toISOString() }, Dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
