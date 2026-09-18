import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ReminderType } from '@prisma/client';
import { CreateHabitReminderDto } from './dto/create-habit-reminder.dto';
import { UpdateHabitReminderDto } from './dto/update-habit-reminder.dto';
import { AttachHabitReminderFoodDto } from './dto/attach-food.dto';
import { SuggestMealResponseDto } from '../ai/dto/suggest-meal-response.dto';

/** Bộ 5 nhắc nhở mặc định — khớp đúng giá trị mặc định trước đây chỉ nằm trong
 * UserPreferencesManager (App), giờ chuyển thành nguồn sự thật duy nhất trên server. */
const DEFAULT_REMINDERS: Array<
  Omit<CreateHabitReminderDto, 'repeatDays'> & {
    type: ReminderType;
    repeatDays: number[];
    sortOrder: number;
    waterIntervalMinutes?: number;
  }
> = [
  {
    type: 'BREAKFAST',
    label: 'Bữa Sáng',
    timeOfDay: '07:30',
    windowStart: '07:00',
    windowEnd: '08:30',
    enabled: true,
    repeatDays: [1, 2, 3, 4, 5, 6, 7],
    advanceNoticeMinutes: 0,
    sortOrder: 0,
  },
  {
    type: 'LUNCH',
    label: 'Bữa Trưa',
    timeOfDay: '12:00',
    windowStart: '11:30',
    windowEnd: '13:00',
    enabled: true,
    repeatDays: [1, 2, 3, 4, 5, 6, 7],
    advanceNoticeMinutes: 0,
    sortOrder: 1,
  },
  {
    type: 'DINNER',
    label: 'Bữa Tối',
    timeOfDay: '19:00',
    windowStart: '19:00',
    windowEnd: '20:30',
    enabled: true,
    repeatDays: [1, 2, 3, 4, 5, 6, 7],
    advanceNoticeMinutes: 0,
    sortOrder: 2,
  },
  {
    type: 'SNACK',
    label: 'Bữa Phụ',
    timeOfDay: '15:30',
    windowStart: '15:00',
    windowEnd: '16:00',
    enabled: false,
    repeatDays: [1, 2, 3, 4, 5, 6, 7],
    advanceNoticeMinutes: 0,
    sortOrder: 3,
  },
  {
    type: 'WATER',
    label: 'Uống Nước',
    timeOfDay: '09:00',
    enabled: true,
    repeatDays: [1, 2, 3, 4, 5, 6, 7],
    advanceNoticeMinutes: 0,
    waterIntervalMinutes: 120,
    sortOrder: 4,
  },
];

@Injectable()
export class HabitRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  /**
   * Danh sách nhắc nhở của user, tự seed 5 nhắc mặc định (Sáng/Trưa/Tối/Phụ/Nước) nếu
   * đây là lần đầu user gọi API này (chưa có bản ghi nào trên server).
   */
  async list(userId: string) {
    const existing = await this.prisma.habitReminder.findMany({
      where: { userId },
      include: { foods: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });

    if (existing.length > 0) {
      return existing;
    }

    await this.prisma.habitReminder.createMany({
      data: DEFAULT_REMINDERS.map((r) => ({
        userId,
        type: r.type,
        label: r.label,
        enabled: r.enabled ?? true,
        timeOfDay: r.timeOfDay,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        repeatDays: r.repeatDays,
        advanceNoticeMinutes: r.advanceNoticeMinutes ?? 0,
        waterIntervalMinutes: r.waterIntervalMinutes,
        sortOrder: r.sortOrder,
      })),
    });

    return this.prisma.habitReminder.findMany({
      where: { userId },
      include: { foods: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(userId: string, dto: CreateHabitReminderDto) {
    const maxSortOrder = await this.prisma.habitReminder.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });

    return this.prisma.habitReminder.create({
      data: {
        userId,
        type: ReminderType.CUSTOM,
        label: dto.label,
        timeOfDay: dto.timeOfDay,
        windowStart: dto.windowStart,
        windowEnd: dto.windowEnd,
        targetCalorieMin: dto.targetCalorieMin,
        targetCalorieMax: dto.targetCalorieMax,
        repeatDays: dto.repeatDays ?? [1, 2, 3, 4, 5, 6, 7],
        advanceNoticeMinutes: dto.advanceNoticeMinutes ?? 0,
        enabled: dto.enabled ?? true,
        sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      },
      include: { foods: true },
    });
  }

  private async findOwned(userId: string, id: string) {
    const reminder = await this.prisma.habitReminder.findUnique({
      where: { id },
    });
    if (!reminder) {
      throw new NotFoundException('Không tìm thấy nhắc nhở');
    }
    if (reminder.userId !== userId) {
      throw new ForbiddenException('Không có quyền truy cập nhắc nhở này');
    }
    return reminder;
  }

  async update(userId: string, id: string, dto: UpdateHabitReminderDto) {
    await this.findOwned(userId, id);

    return this.prisma.habitReminder.update({
      where: { id },
      data: {
        label: dto.label,
        timeOfDay: dto.timeOfDay,
        windowStart: dto.windowStart,
        windowEnd: dto.windowEnd,
        targetCalorieMin: dto.targetCalorieMin,
        targetCalorieMax: dto.targetCalorieMax,
        waterIntervalMinutes: dto.waterIntervalMinutes,
        repeatDays: dto.repeatDays,
        advanceNoticeMinutes: dto.advanceNoticeMinutes,
        enabled: dto.enabled,
      },
      include: { foods: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async remove(userId: string, id: string) {
    const reminder = await this.findOwned(userId, id);
    if (reminder.type !== ReminderType.CUSTOM) {
      throw new BadRequestException(
        'Không thể xoá nhắc nhở mặc định — chỉ có thể tắt (enabled=false)',
      );
    }
    await this.prisma.habitReminder.delete({ where: { id } });
    return { message: 'Đã xoá nhắc nhở' };
  }

  async addFood(userId: string, id: string, dto: AttachHabitReminderFoodDto) {
    await this.findOwned(userId, id);

    const maxSortOrder = await this.prisma.habitReminderFood.aggregate({
      where: { habitReminderId: id },
      _max: { sortOrder: true },
    });

    await this.prisma.habitReminderFood.create({
      data: {
        habitReminderId: id,
        name: dto.name,
        servingSize: dto.servingSize,
        calories: dto.calories,
        protein: dto.protein,
        carb: dto.carb,
        fat: dto.fat,
        sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return this.prisma.habitReminder.findUnique({
      where: { id },
      include: { foods: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async removeFood(userId: string, id: string, foodId: string) {
    await this.findOwned(userId, id);

    const food = await this.prisma.habitReminderFood.findUnique({
      where: { id: foodId },
    });
    if (!food || food.habitReminderId !== id) {
      throw new NotFoundException('Không tìm thấy món ăn đã gắn');
    }

    await this.prisma.habitReminderFood.delete({ where: { id: foodId } });

    return this.prisma.habitReminder.findUnique({
      where: { id },
      include: { foods: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Gợi ý món ăn Eat Clean lấp đầy đúng mục tiêu calo của RIÊNG nhắc nhở này
   * (VD "Bữa Tối 345-450 kcal"), tái dùng logic Gemini/Smart Fallback có sẵn ở AiService.suggestMealForGap
   * thay vì tính theo toàn bộ ngày như ai/suggest-meal.
   */
  async suggestFoods(
    userId: string,
    id: string,
  ): Promise<SuggestMealResponseDto> {
    const reminder = await this.findOwned(userId, id);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        goal: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
      },
    });

    const targetCalorieForMeal =
      reminder.targetCalorieMax ??
      reminder.targetCalorieMin ??
      Math.round((user?.targetCalories || 2000) / 3);

    // Ước lượng macro theo đúng tỷ lệ macro mục tiêu cả ngày của user, scale theo calo của riêng bữa này
    // (không có cách nào biết chính xác tỷ lệ macro mong muốn cho 1 bữa lẻ, nên suy ra tỷ lệ tương ứng).
    const dailyCalories = user?.targetCalories || 2000;
    const ratio =
      dailyCalories > 0 ? targetCalorieForMeal / dailyCalories : 1 / 3;

    const nutritionGap = {
      remainingCalories: Math.round(targetCalorieForMeal),
      remainingProtein: Math.round((user?.targetProtein || 140) * ratio),
      remainingCarbs: Math.round((user?.targetCarb || 200) * ratio),
      remainingFat: Math.round((user?.targetFat || 60) * ratio),
    };

    return this.aiService.suggestMealForGap(user?.goal || null, nutritionGap);
  }
}
