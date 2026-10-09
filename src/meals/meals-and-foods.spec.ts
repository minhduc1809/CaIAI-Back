import { Test, TestingModule } from '@nestjs/testing';
import { MealsService } from './meals.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MealType } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Nhóm E: Ghi bữa ăn, món quen & kiểm tra Atwater (BR-07.3, BR-07.4, BR-07.5, BR-07.7, BR-08.4)', () => {
  let mealsService: MealsService;
  let recommendationsService: RecommendationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      meal: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      mealItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      customFood: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      notification: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealsService,
        RecommendationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    mealsService = module.get<MealsService>(MealsService);
    recommendationsService = module.get<RecommendationsService>(
      RecommendationsService,
    );
  });

  describe('E1 & E3: Nguồn gốc món trong bữa & Idempotency qua clientRequestId (BR-07.3, BR-07.5)', () => {
    it('lưu sourceType, sourceId cho từng món và suy luận nếu không truyền', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      prisma.meal.create.mockImplementation((args: any) => ({
        id: 'meal_1',
        ...args.data,
      }));

      const res = await mealsService.createMeal('u1', {
        mealType: MealType.LUNCH,
        date: '2026-10-09',
        items: [
          {
            name: 'Phở bò',
            calories: 450,
            protein: 25,
            carb: 55,
            fat: 12,
            sourceType: 'CATALOG',
            sourceId: 'cat_pho_1',
          },
          {
            name: 'Cơm tấm sườn',
            calories: 600,
            protein: 20,
            carb: 70,
            fat: 25,
            source: 'quick_add',
          },
        ],
      });

      expect(prisma.meal.create).toHaveBeenCalled();
      const createData = prisma.meal.create.mock.calls[0][0].data;
      expect(createData.items.create[0].sourceType).toBe('CATALOG');
      expect(createData.items.create[0].sourceId).toBe('cat_pho_1');
      expect(createData.items.create[1].sourceType).toBe('QUICK_ADD');
    });

    it('E3: gửi lại request cùng clientRequestId trả về bữa ăn cũ mà không tạo mới (Idempotent)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const existingMeal = {
        id: 'existing_meal_id',
        clientRequestId: 'req-uuid-1234',
        userId: 'u1',
        items: [{ name: 'Bánh mì', calories: 300 }],
      };
      prisma.meal.findFirst.mockResolvedValue(existingMeal);

      const res = await mealsService.createMeal('u1', {
        clientRequestId: 'req-uuid-1234',
        mealType: MealType.BREAKFAST,
        date: '2026-10-09',
        items: [{ name: 'Bánh mì', calories: 300 }],
      });

      expect(res.data).toEqual(existingMeal);
      expect(prisma.meal.create).not.toHaveBeenCalled();
    });
  });

  describe('E2: Gỡ món cuối cùng trong bữa ăn (BR-07.4)', () => {
    it('gửi items rỗng [] thì xoá luôn cả bữa ăn', async () => {
      prisma.meal.findUnique.mockResolvedValue({
        id: 'meal_1',
        userId: 'u1',
        items: [{ id: 'item_1' }],
      });
      prisma.meal.delete.mockResolvedValue({ id: 'meal_1' });

      const res = await mealsService.updateMeal('u1', 'meal_1', {
        items: [],
      });

      expect(prisma.meal.delete).toHaveBeenCalledWith({
        where: { id: 'meal_1' },
      });
      expect(res.message).toContain(
        'Đã xoá món cuối cùng — bữa ăn được xoá theo',
      );
      expect(res.data).toBeNull();
    });
  });

  describe('E4: Món quen (BR-07.7)', () => {
    it('gom các món log trong 30 ngày, đếm số lần, loại món 0 calo và món vi phạm dị ứng', async () => {
      prisma.user.findUnique.mockResolvedValue({
        dietType: 'VEGETARIAN',
        allergies: ['PEANUT'],
      });

      const thirtyDaysAgo = new Date();
      prisma.meal.findMany.mockResolvedValue([
        {
          mealType: MealType.LUNCH,
          logDate: new Date(),
          items: [
            {
              name: 'Đậu phụ sốt cà chua',
              calories: 250,
              protein: 15,
              carb: 10,
              fat: 12,
              quantity: 1,
            },
            {
              name: 'Bún chả thịt nướng',
              calories: 500,
              protein: 25,
              carb: 60,
              fat: 15,
              quantity: 1,
            }, // Vi phạm ăn chay
            {
              name: 'Nước lọc',
              calories: 0,
              protein: 0,
              carb: 0,
              fat: 0,
              quantity: 1,
            }, // 0 calo
          ],
        },
        {
          mealType: MealType.LUNCH,
          logDate: new Date(),
          items: [
            {
              name: 'Đậu phụ sốt cà chua',
              calories: 250,
              protein: 15,
              carb: 10,
              fat: 12,
              quantity: 1,
            },
          ],
        },
      ]);

      const res = await mealsService.getFrequentFoods('u1', MealType.LUNCH);
      expect(res.data.length).toBe(1);
      expect(res.data[0].name).toBe('Đậu phụ sốt cà chua');
      expect(res.data[0].count).toBe(2);
    });
  });

  describe('E8: Kiểm tra Atwater cho món tự tạo (BR-08.4)', () => {
    it('cảnh báo mềm khi calo lệch > 15% so với 4P + 4C + 9F', async () => {
      // P=10, C=10, F=10 -> 40 + 40 + 90 = 170 kcal
      // Người dùng nhập calories = 300 kcal (lệch > 15%)
      prisma.customFood.create.mockImplementation((args: any) => ({
        id: 'cf_1',
        ...args.data,
      }));

      const res = await recommendationsService.createCustomFood('u1', {
        name: 'Món calo ảo',
        calories: 300,
        protein: 10,
        carb: 10,
        fat: 10,
      });

      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings[0]).toContain('lệch hơn 15%');
      expect(res.data.name).toBe('Món calo ảo');
    });

    it('không cảnh báo khi số liệu calo và macro khớp hợp lý', async () => {
      // P=25, C=50, F=10 -> 100 + 200 + 90 = 390 kcal
      // Nhập calories = 400 kcal (lệch ~2.5% < 15%)
      prisma.customFood.create.mockImplementation((args: any) => ({
        id: 'cf_2',
        ...args.data,
      }));

      const res = await recommendationsService.createCustomFood('u1', {
        name: 'Món chuẩn',
        calories: 400,
        protein: 25,
        carb: 50,
        fat: 10,
      });

      expect(res.warnings.length).toBe(0);
    });

    it('chặn số liệu vượt trần an toàn (> 5000 kcal hoặc > 500g macro)', async () => {
      await expect(
        recommendationsService.createCustomFood('u1', {
          name: 'Món khổng lồ',
          calories: 9999,
          protein: 50,
          carb: 50,
          fat: 50,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updateCustomFood: cập nhật thành công món tự tạo và kiểm tra Atwater', async () => {
      prisma.customFood.findUnique.mockResolvedValue({
        id: 'cf_1',
        userId: 'u1',
        name: 'Món cũ',
        calories: 300,
        protein: 20,
        carb: 30,
        fat: 10,
      });
      prisma.customFood.update.mockImplementation((args: any) => ({
        id: 'cf_1',
        userId: 'u1',
        ...args.data,
      }));

      const res = await recommendationsService.updateCustomFood('u1', 'cf_1', {
        name: 'Món mới sửa',
        calories: 290,
      });

      expect(res.data.name).toBe('Món mới sửa');
      expect(prisma.customFood.update).toHaveBeenCalled();
    });

    it('updateCustomFood: từ chối sửa món của người dùng khác', async () => {
      prisma.customFood.findUnique.mockResolvedValue({
        id: 'cf_other',
        userId: 'other_user',
      });

      await expect(
        recommendationsService.updateCustomFood('u1', 'cf_other', {
          name: 'Hack',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
