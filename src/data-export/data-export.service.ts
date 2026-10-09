import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { dayBoundsForKey, resolveTimezone, todayKey } from '../common/utils/date-zone.util';
import { CsvColumn, toCsv } from './csv';
import { ZipEntry, createZip } from './zip';

/**
 * Các cột của hồ sơ KHÔNG bao giờ đưa vào file xuất: mật khẩu, mã xác thực, mã đặt lại mật khẩu, mã băm refresh token,
 * định danh Google. Đây là bí mật xác thực chứ không phải dữ liệu sức khỏe của người dùng.
 */
export const PROFILE_EXCLUDED_FIELDS = [
  'password',
  'emailVerificationCode',
  'emailVerificationExpiresAt',
  'passwordResetCode',
  'passwordResetExpiresAt',
  'refreshTokenHash',
  'googleId',
] as const;

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  files: string[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Xuất toàn bộ dữ liệu của chính người dùng (BR-18). Luôn dùng được ở mọi gói, tối đa một lần mỗi ngày
   * (theo múi giờ của người dùng). Lượt trong ngày được giữ chỗ nguyên tử TRƯỚC khi gom dữ liệu để hai yêu cầu
   * đồng thời không cùng xuất; nếu gom dữ liệu thất bại thì trả lại lượt.
   */
  async exportUserData(userId: string, now: Date = new Date()): Promise<ExportResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, lastExportAt: true },
    });
    const tz = resolveTimezone(user?.timezone);
    const dayKey = todayKey(tz, now);
    const { start, end } = dayBoundsForKey(dayKey, tz);

    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastExportAt: null }, { lastExportAt: { lt: start } }],
      },
      data: { lastExportAt: now },
    });
    if (claimed.count === 0) {
      throw new QuotaExceededException({
        feature: 'DATA_EXPORT',
        limit: 1,
        used: 1,
        period: 'day',
        resetsAt: end,
        isPremium: true, // không phụ thuộc gói: không mời nâng cấp
      });
    }

    try {
      return await this.build(userId, now, dayKey);
    } catch (error) {
      // Trả lại lượt để người dùng thử lại, nhưng chỉ khi chưa có lần xuất khác chen vào
      await this.prisma.user
        .updateMany({
          where: { id: userId, lastExportAt: now },
          data: { lastExportAt: user?.lastExportAt ?? null },
        })
        .catch(() => undefined);
      this.logger.error(`Xuất dữ liệu thất bại cho ${userId}: ${(error as Error).message}`);
      throw error;
    }
  }

  private async build(userId: string, now: Date, dayKey: string): Promise<ExportResult> {
    const where = { userId };
    const p = this.prisma;

    const [
      user,
      goals,
      targetChanges,
      meals,
      weightLogs,
      workouts,
      checkIns,
      expenditure,
      waterLogs,
      customFoods,
      favoriteFoods,
      reminders,
      dayStatuses,
      aiMessages,
      weeklySummaries,
      subscription,
      grants,
      orders,
    ] = await Promise.all([
      p.user.findUnique({ where: { id: userId } }),
      p.goal.findMany({ where, orderBy: { startDate: 'asc' } }),
      p.targetChange.findMany({ where, orderBy: { createdAt: 'asc' } }),
      p.meal.findMany({ where, orderBy: [{ logDate: 'asc' }, { createdAt: 'asc' }], include: { items: true } }),
      p.weightLog.findMany({ where, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      p.workoutLog.findMany({
        where,
        orderBy: { date: 'asc' },
        include: { exercises: { orderBy: { order: 'asc' }, include: { sets: { orderBy: { setNumber: 'asc' } } } } },
      }),
      p.checkIn.findMany({ where, orderBy: { createdAt: 'asc' } }),
      p.expenditureSnapshot.findMany({ where, orderBy: { recordedAt: 'asc' } }),
      p.waterLog.findMany({ where, orderBy: { loggedAt: 'asc' } }),
      p.customFood.findMany({ where, orderBy: { createdAt: 'asc' } }),
      p.favoriteFood.findMany({ where, orderBy: { createdAt: 'asc' } }),
      p.habitReminder.findMany({ where, orderBy: { sortOrder: 'asc' }, include: { foods: true } }),
      p.dailyLogStatus.findMany({ where, orderBy: { logDate: 'asc' } }),
      p.aiMessage.findMany({ where, orderBy: { createdAt: 'asc' } }),
      p.weeklySummary.findMany({ where, orderBy: { weekStartDate: 'asc' } }),
      p.subscriptionState.findUnique({ where: { userId } }),
      p.manualGrant.findMany({ where, orderBy: { startsAt: 'asc' } }),
      p.paymentOrder.findMany({ where, orderBy: { createdAt: 'asc' } }),
    ]);

    // Hồ sơ: bỏ các trường bí mật xác thực
    const profile: Record<string, unknown> = { ...(user ?? {}) };
    for (const field of PROFILE_EXCLUDED_FIELDS) delete profile[field];

    const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8');
    const entries: ZipEntry[] = [];
    const counts: Record<string, number> = {};
    const add = (name: string, data: Buffer, count?: number) => {
      entries.push({ name, data });
      if (count !== undefined) counts[name] = count;
    };

    add('profile.json', json(profile), 1);
    add('goals.json', json(goals), goals.length);
    add('target-changes.json', json(targetChanges), targetChanges.length);
    add('meals.json', json(meals), meals.length);
    add('weight-logs.json', json(weightLogs), weightLogs.length);
    add('workouts.json', json(workouts), workouts.length);
    add('check-ins.json', json(checkIns), checkIns.length);
    add('expenditure-snapshots.json', json(expenditure), expenditure.length);
    add('water-logs.json', json(waterLogs), waterLogs.length);
    add('custom-foods.json', json(customFoods), customFoods.length);
    add('favorite-foods.json', json(favoriteFoods), favoriteFoods.length);
    add('habit-reminders.json', json(reminders), reminders.length);
    add('daily-log-status.json', json(dayStatuses), dayStatuses.length);
    add('ai-chat-messages.json', json(aiMessages), aiMessages.length);
    add('weekly-summaries.json', json(weeklySummaries), weeklySummaries.length);
    add(
      'subscription.json',
      json({
        // Không xuất mã giao dịch (purchaseToken) và định danh quản trị viên
        subscription: subscription && {
          productId: subscription.productId,
          status: subscription.status,
          expiryTime: iso(subscription.expiryTime),
          autoRenewing: subscription.autoRenewing,
          isTrial: subscription.isTrial,
        },
        grants: grants.map((g) => ({ startsAt: iso(g.startsAt), endsAt: iso(g.endsAt), revokedAt: iso(g.revokedAt) })),
        paymentOrders: orders.map((o) => ({
          code: o.code,
          productId: o.productId,
          amount: o.amount,
          status: o.status,
          createdAt: iso(o.createdAt),
          paidAt: iso(o.paidAt),
        })),
      }),
    );

    // ----- CSV dễ mở bằng Excel: mỗi dòng một bản ghi -----
    type MealRow = { meal: (typeof meals)[number]; item: (typeof meals)[number]['items'][number] };
    const mealRows: MealRow[] = meals.flatMap((meal) => meal.items.map((item) => ({ meal, item })));
    const mealColumns: CsvColumn<MealRow>[] = [
      { header: 'ngay', value: (r) => iso(r.meal.logDate)?.slice(0, 10) },
      { header: 'bua_an', value: (r) => r.meal.mealType },
      { header: 'ten_mon', value: (r) => r.item.name },
      { header: 'khau_phan', value: (r) => r.item.servingSize },
      { header: 'so_phan', value: (r) => r.item.quantity },
      { header: 'calo_tren_1_phan', value: (r) => r.item.calories },
      { header: 'dam_g_tren_1_phan', value: (r) => r.item.protein },
      { header: 'tinh_bot_g_tren_1_phan', value: (r) => r.item.carb },
      { header: 'beo_g_tren_1_phan', value: (r) => r.item.fat },
      { header: 'calo_tong', value: (r) => round1(r.item.calories * r.item.quantity) },
      { header: 'nguon', value: (r) => r.item.source },
    ];
    add('meals.csv', toCsv(mealRows, mealColumns), mealRows.length);

    add(
      'weight-logs.csv',
      toCsv(weightLogs, [
        { header: 'thoi_diem', value: (w) => w.date },
        { header: 'can_nang_kg', value: (w) => w.weightKg },
        { header: 'ghi_chu', value: (w) => w.note },
      ]),
      weightLogs.length,
    );

    add(
      'workouts.csv',
      toCsv(workouts, [
        { header: 'thoi_diem', value: (w) => w.date },
        { header: 'ten_buoi_tap', value: (w) => w.name },
        { header: 'loai', value: (w) => w.category },
        { header: 'thoi_luong_phut', value: (w) => w.durationMinutes },
        { header: 'calo_tieu_hao', value: (w) => w.caloriesBurned },
        { header: 'rpe', value: (w) => w.rpe },
        { header: 'ghi_chu', value: (w) => w.note },
      ]),
      workouts.length,
    );

    type SetRow = { workout: (typeof workouts)[number]; exercise: string; set: { setNumber: number; reps: number; weightKg: number; rpe: number | null } };
    const setRows: SetRow[] = workouts.flatMap((workout) =>
      workout.exercises.flatMap((ex) => ex.sets.map((set) => ({ workout, exercise: ex.name, set }))),
    );
    add(
      'workout-sets.csv',
      toCsv(setRows, [
        { header: 'thoi_diem_buoi_tap', value: (r) => r.workout.date },
        { header: 'ten_buoi_tap', value: (r) => r.workout.name },
        { header: 'bai_tap', value: (r) => r.exercise },
        { header: 'hiep', value: (r) => r.set.setNumber },
        { header: 'so_lan', value: (r) => r.set.reps },
        { header: 'ta_kg', value: (r) => r.set.weightKg },
        { header: 'rpe', value: (r) => r.set.rpe },
      ]),
      setRows.length,
    );

    add(
      'water-logs.csv',
      toCsv(waterLogs, [
        { header: 'thoi_diem', value: (w) => w.loggedAt },
        { header: 'luong_nuoc_ml', value: (w) => w.amountMl },
      ]),
      waterLogs.length,
    );

    add(
      'expenditure-snapshots.csv',
      toCsv(expenditure, [
        { header: 'thoi_diem', value: (s) => s.recordedAt },
        { header: 'tieu_hao_thich_ung_kcal', value: (s) => s.adaptiveExpenditure },
        { header: 'tdee_tinh_kcal', value: (s) => s.staticTdee },
        { header: 'trang_thai', value: (s) => s.status },
      ]),
      expenditure.length,
    );

    add(
      'custom-foods.csv',
      toCsv(customFoods, [
        { header: 'ten_mon', value: (f) => f.name },
        { header: 'khau_phan', value: (f) => f.servingSize },
        { header: 'calo', value: (f) => f.calories },
        { header: 'dam_g', value: (f) => f.protein },
        { header: 'tinh_bot_g', value: (f) => f.carb },
        { header: 'beo_g', value: (f) => f.fat },
        { header: 'nguyen_lieu', value: (f) => f.ingredients },
      ]),
      customFoods.length,
    );

    add(
      'target-changes.csv',
      toCsv(targetChanges, [
        { header: 'thoi_diem', value: (c) => c.createdAt },
        { header: 'nguon', value: (c) => c.source },
        { header: 'calo_cu', value: (c) => c.oldCalories },
        { header: 'calo_moi', value: (c) => c.newCalories },
      ]),
      targetChanges.length,
    );

    const manifest = {
      app: 'NutriWise',
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: now.toISOString(),
      exportDate: dayKey,
      userId,
      files: counts,
    };
    add('manifest.json', json(manifest));
    add('README.txt', Buffer.from(readme(now, counts), 'utf8'));

    const buffer = createZip(entries, now);
    return {
      buffer,
      filename: `nutriwise-export-${dayKey}.zip`,
      files: entries.map((e) => e.name),
    };
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function readme(now: Date, counts: Record<string, number>): string {
  const lines = Object.entries(counts).map(([file, n]) => `  - ${file}: ${n} bản ghi`);
  return [
    'DỮ LIỆU CÁ NHÂN NUTRIWISE',
    `Xuất lúc: ${now.toISOString()}`,
    '',
    'Gói này chứa toàn bộ dữ liệu của bạn trong NutriWise: hồ sơ, mục tiêu và lịch sử đổi mục tiêu, bữa ăn, cân nặng,',
    'tập luyện, Check-in, Expenditure, nước uống, món tự tạo, nhắc nhở, lịch sử trò chuyện AI và thông tin gói.',
    '',
    'Mỗi dữ liệu có hai dạng:',
    '  - File .json: đầy đủ mọi trường, dùng để lưu trữ hoặc chuyển sang nơi khác.',
    '  - File .csv: mỗi dòng một bản ghi, mở được bằng Excel hoặc Google Sheets (mã hoá UTF-8).',
    '',
    'Số bản ghi trong từng file:',
    ...lines,
    '',
    'Lưu ý:',
    '  - Calo/macro của món trong bữa ăn là giá trị trên MỘT phần; calo_tong = calo trên 1 phần x số phần.',
    '  - Thời gian ở dạng ISO 8601 theo UTC; cột "ngay" của bữa ăn là ngày theo múi giờ của bạn.',
    '  - Mật khẩu, mã xác thực và các khoá đăng nhập không nằm trong gói này.',
    '  - Bạn có thể xuất dữ liệu một lần mỗi ngày.',
    '',
  ].join('\r\n');
}
