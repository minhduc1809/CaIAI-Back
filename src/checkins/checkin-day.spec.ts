import { ValidationPipe } from '@nestjs/common';
import { CheckinsService } from './checkins.service';
import { HealthCalculatorService } from '../users/health-calculator.service';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { dateToKey, weekdayOnOrAfter, weekdayOnOrBefore } from '../common/utils/date-zone.util';

const FAKE_DATE_ONLY = [
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'performance', 'hrtime',
] as const;
const freezeNow = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: [...FAKE_DATE_ONLY] });
afterEach(() => jest.useRealTimers());

// Lịch tháng 10/2026: Thứ Hai 05, 12, 19, 26; Thứ Tư 07, 14, 21.

describe('Tiện ích tìm thứ trong tuần', () => {
  it('weekdayOnOrBefore: đúng ngày thì giữ nguyên, khác ngày thì lùi về lần gần nhất', () => {
    expect(weekdayOnOrBefore('2026-10-14', 3)).toBe('2026-10-14'); // Thứ Tư đúng ngày
    expect(weekdayOnOrBefore('2026-10-13', 3)).toBe('2026-10-07'); // Thứ Ba → Thứ Tư tuần trước
    expect(weekdayOnOrBefore('2026-10-12', 1)).toBe('2026-10-12'); // Thứ Hai
    expect(weekdayOnOrBefore('2026-10-18', 1)).toBe('2026-10-12'); // Chủ Nhật → Thứ Hai trước đó
    expect(weekdayOnOrBefore('2026-10-12', 7)).toBe('2026-10-11'); // Thứ Hai → Chủ Nhật hôm qua
  });

  it('weekdayOnOrAfter: tiến tới lần gần nhất sau hoặc đúng ngày', () => {
    expect(weekdayOnOrAfter('2026-10-14', 3)).toBe('2026-10-14');
    expect(weekdayOnOrAfter('2026-10-15', 3)).toBe('2026-10-21');
    expect(weekdayOnOrAfter('2026-10-12', 7)).toBe('2026-10-18');
  });

  it('mọi ngày trong tuần đều cho kết quả đúng thứ và nằm trong 6 ngày', () => {
    for (let day = 1; day <= 7; day++) {
      for (let i = 0; i < 14; i++) {
        const key = dateToKey(new Date(Date.UTC(2026, 9, 1 + i)));
        const before = weekdayOnOrBefore(key, day);
        const after = weekdayOnOrAfter(key, day);
        expect(new Date(before + 'T00:00:00Z').getUTCDay() % 7).toBe(day % 7);
        expect(new Date(after + 'T00:00:00Z').getUTCDay() % 7).toBe(day % 7);
        expect(before <= key && key <= after).toBe(true);
        expect(new Date(after).getTime() - new Date(before).getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      }
    }
  });
});

function build(opts: {
  checkinDay?: number;
  createdAt?: Date | null;
  existing?: any;
  overlapping?: any;
  method?: 'ADAPTIVE' | 'STATIC_FALLBACK';
  engineMessage?: string;
  weightLogsCount?: number;
  mealDays?: number; // số ngày ĐẦY ĐỦ trong kỳ (bắt đầu từ startKey)
  startKey?: string;
}) {
  const user: any = {
    id: 'u1',
    createdAt: opts.createdAt === undefined ? new Date('2026-01-01T00:00:00Z') : opts.createdAt,
    checkinDay: opts.checkinDay,
    timezone: 'Asia/Ho_Chi_Minh',
    goal: 'MAINTAIN',
    gender: 'MALE',
    heightCm: 175,
    weightKg: 70,
    proteinPreference: 'MID',
    macroStyle: 'BALANCED',
    targetCalories: 2000,
    targetProtein: 112,
    targetCarb: 200,
    targetFat: 80,
    tdee: 2000,
  };
  const meals: any[] = [];
  for (let i = 0; i < (opts.mealDays ?? 0); i++) {
    const day = new Date(opts.startKey + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + i);
    for (let m = 0; m < 3; m++) {
      meals.push({ logDate: day, totalCalories: 700, totalProtein: 30, totalCarb: 80, totalFat: 20 });
    }
  }
  const prisma: any = {
    user: { findUnique: jest.fn(async () => user) },
    meal: { findMany: jest.fn(async () => meals) },
    weightLog: { findMany: jest.fn(async () => []) },
    dailyLogStatus: { findMany: jest.fn(async () => []) },
    checkIn: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => opts.existing ?? null),
      findFirst: jest.fn(async () => opts.overlapping ?? null),
      create: jest.fn(async (args: any) => ({ id: 'new', ...args.data })),
    },
  };
  const expenditure: any = {
    recalculate: jest.fn(async () => ({
      estimatedExpenditure: 2000,
      method: opts.method ?? 'ADAPTIVE',
      status: 'STABLE',
      message: opts.engineMessage,
      weightLogsCount: opts.weightLogsCount,
    })),
  };
  const weights: any = { getWeightProgress: jest.fn(async () => ({ data: { progressPercent: 0 } })) };
  const service = new CheckinsService(prisma, expenditure, new HealthCalculatorService(), weights, { create: jest.fn() } as any);
  return { service, prisma, user };
}

describe('Ngày Check-in do người dùng chọn (BR-06.1/06.2)', () => {
  it('mặc định Thứ Hai: Thứ Tư 14/10 dùng kỳ 05/10 – 11/10', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({});
    await service.generateCheckin('u1', {});
    const data = prisma.checkIn.create.mock.calls[0][0].data;
    expect(dateToKey(data.weekStartDate)).toBe('2026-10-05');
  });

  it('chọn Thứ Tư: Thứ Tư 14/10 dùng kỳ 07/10 – 13/10 (kỳ kết thúc hôm qua)', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({ checkinDay: 3 });
    await service.generateCheckin('u1', {});
    const data = prisma.checkIn.create.mock.calls[0][0].data;
    expect(dateToKey(data.weekStartDate)).toBe('2026-10-07');
    expect(dateToKey(data.weekEndDate)).toBe('2026-10-13');
  });

  it('chọn Thứ Tư: Thứ Ba 13/10 vẫn dùng kỳ của Thứ Tư trước (30/09 – 06/10)', async () => {
    freezeNow('2026-10-13T03:00:00Z');
    const { service, prisma } = build({ checkinDay: 3 });
    await service.generateCheckin('u1', {});
    expect(dateToKey(prisma.checkIn.create.mock.calls[0][0].data.weekStartDate)).toBe('2026-09-30');
  });

  it('chọn Chủ Nhật: Chủ Nhật 18/10 dùng kỳ 7 ngày kết thúc hôm qua (11/10 – 17/10)', async () => {
    freezeNow('2026-10-18T03:00:00Z'); // Chủ Nhật
    const { service, prisma } = build({ checkinDay: 7 });
    await service.generateCheckin('u1', {});
    const data = prisma.checkIn.create.mock.calls[0][0].data;
    expect(dateToKey(data.weekStartDate)).toBe('2026-10-11');
    expect(dateToKey(data.weekEndDate)).toBe('2026-10-17');
  });

  it('trả ngày Check-in kế tiếp theo ngày đã chọn', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const a = await build({ checkinDay: 3 }).service.generateCheckin('u1', {});
    expect((a as any).data.nextCheckinDate).toBe('2026-10-21');
    expect((a as any).data.checkinDay).toBe(3);
    const b = await build({}).service.generateCheckin('u1', {});
    expect((b as any).data.nextCheckinDate).toBe('2026-10-19');
  });
});

describe('Tài khoản mới và đổi ngày Check-in (BR-06.3)', () => {
  it('chưa có đủ một kỳ 7 ngày trọn vẹn: không tạo Check-in, báo ngày Check-in đầu tiên', async () => {
    freezeNow('2026-10-14T03:00:00Z'); // Thứ Tư, kỳ sẽ là 05–11/10
    const { service, prisma } = build({ createdAt: new Date('2026-10-10T03:00:00Z') });
    const res: any = await service.generateCheckin('u1', {});
    expect(prisma.checkIn.create).not.toHaveBeenCalled();
    expect(res.data.checkIn).toBeNull();
    expect(res.data.tooEarly).toBe(true);
    // 10/10 + 7 ngày = 17/10 → Thứ Hai đầu tiên sau đó là 19/10
    expect(res.data.nextCheckinDate).toBe('2026-10-19');
  });

  it('ngày Check-in đầu tiên theo ngày đã chọn (Thứ Tư → 21/10)', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const res: any = await build({ checkinDay: 3, createdAt: new Date('2026-10-10T03:00:00Z') }).service.generateCheckin('u1', {});
    expect(res.data.nextCheckinDate).toBe('2026-10-21');
  });

  it('tài khoản tạo đúng đầu kỳ thì được Check-in ngay kỳ đó', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({ createdAt: new Date('2026-10-05T01:00:00Z') });
    await service.generateCheckin('u1', {});
    expect(prisma.checkIn.create).toHaveBeenCalled();
  });

  it('đổi ngày Check-in làm kỳ mới chồng kỳ đã có: trả lại Check-in đã có, không tạo thêm', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const old = {
      id: 'old',
      status: 'PENDING',
      weekStartDate: new Date('2026-10-05T00:00:00Z'),
      weekEndDate: new Date('2026-10-11T23:59:59Z'),
      adjustmentReason: 'NO_CHANGE',
      currentCalorieTarget: 2000,
      proposedCalorieTarget: 2000,
      newExpenditure: 2000,
      compliancePct: null,
    };
    const { service, prisma } = build({ checkinDay: 3, overlapping: old });
    const res: any = await service.generateCheckin('u1', {});
    expect(prisma.checkIn.create).not.toHaveBeenCalled();
    expect(res.data.checkIn.id).toBe('old');
  });
});

describe('Việc cần làm khi thiếu dữ liệu (BR-06.3)', () => {
  it('lấy lý do thật từ engine, bỏ câu nhắc "công thức TDEE tĩnh", và đếm ngày ghi đủ của kỳ', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({
      method: 'STATIC_FALLBACK',
      engineMessage:
        'Cần cân thêm ít nhất 3 ngày nữa (trong 28 ngày gần đây) để bắt đầu tính Expenditure thích ứng. Hiện đang dùng công thức TDEE tĩnh.',
      weightLogsCount: 1,
      mealDays: 2,
      startKey: '2026-10-05',
    });
    const res: any = await service.generateCheckin('u1', {});
    const data = prisma.checkIn.create.mock.calls[0][0].data;
    expect(data.status).toBe('INSUFFICIENT_DATA');
    expect(data.completeDays).toBe(2);
    expect(data.dataNeeds.steps[0]).toMatch(/cân thêm ít nhất 3 ngày/);
    expect(data.dataNeeds.steps.join(' ')).not.toMatch(/TDEE tĩnh/);
    expect(data.dataNeeds.steps.join(' ')).toMatch(/2\/7 ngày ghi đủ/);
    expect(data.dataNeeds).toMatchObject({ loggedDays: 2, weighInDays: 1 });
    // App nhận danh sách việc cần làm trong nội dung giải thích
    expect(res.data.coachingContent.todo).toEqual(data.dataNeeds.steps);
  });

  it('đủ ngày ghi nhưng engine không nêu lý do: vẫn có một việc cần làm chung', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({ method: 'STATIC_FALLBACK', mealDays: 6, startKey: '2026-10-05' });
    await service.generateCheckin('u1', {});
    const steps = prisma.checkIn.create.mock.calls[0][0].data.dataNeeds.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/tiếp tục ghi/i);
  });

  it('Check-in có đề xuất thì không có dataNeeds và không có todo', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const { service, prisma } = build({ method: 'ADAPTIVE', mealDays: 6, startKey: '2026-10-05' });
    const res: any = await service.generateCheckin('u1', {});
    expect(prisma.checkIn.create.mock.calls[0][0].data.dataNeeds).toBeUndefined();
    expect(res.data.coachingContent.todo).toBeUndefined();
  });
});

describe('Check-in đang chờ trả kèm ngày kế tiếp', () => {
  it('không có Check-in chờ: vẫn trả nextCheckinDate và checkinDay để app hiển thị', async () => {
    freezeNow('2026-10-14T03:00:00Z');
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', checkinDay: 5 })) },
      checkIn: { updateMany: jest.fn(async () => ({ count: 0 })), findFirst: jest.fn(async () => null) },
    };
    const service = new CheckinsService(prisma, {} as any, {} as any, {} as any, {} as any);
    const res: any = await service.getPendingCheckin('u1');
    expect(res.data.checkIn).toBeNull();
    expect(res.data.nextCheckinDate).toBe('2026-10-16'); // Thứ Sáu kế tiếp
    expect(res.data.checkinDay).toBe(5);
  });
});

describe('Lưu ngày Check-in trong hồ sơ', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (value: any) => pipe.transform(value, { type: 'body', metatype: UpdateProfileDto });

  it.each([1, 3, 7])('ngày %p hợp lệ', async (day) => {
    await expect(validate({ checkinDay: day })).resolves.toMatchObject({ checkinDay: day });
  });

  it.each([0, 8, -1, 2.5, '3x'])('ngày %p bị từ chối', async (day) => {
    await expect(validate({ checkinDay: day })).rejects.toBeDefined();
  });

  it('updateProfile lưu checkinDay và không đụng tới mục tiêu dinh dưỡng', async () => {
    const user: any = {
      id: 'u1',
      weightKg: 70,
      heightCm: 175,
      dateOfBirth: new Date('1995-01-01'),
      gender: 'MALE',
      goal: 'MAINTAIN',
      targetCalories: 2000,
      checkinDay: 1,
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
      goal: { updateMany: jest.fn(), create: jest.fn() },
      targetChange: { create: jest.fn() },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({ method: 'STATIC_FALLBACK', status: 'STATIC', estimatedExpenditure: null })),
      recordSnapshot: jest.fn(),
    };
    const service = new UsersService(prisma, new HealthCalculatorService(), adaptive);
    await service.updateProfile('u1', { checkinDay: 5 });
    expect(prisma.user.update.mock.calls[0][0].data.checkinDay).toBe(5);
    expect(prisma.targetChange.create).not.toHaveBeenCalled();

    // Không gửi checkinDay thì giữ giá trị cũ
    await service.updateProfile('u1', { timezone: 'Asia/Ho_Chi_Minh' });
    expect(prisma.user.update.mock.calls[1][0].data.checkinDay).toBe(1);
  });
});

describe('Phản hồi "Đã hiểu" cho Check-in thiếu dữ liệu', () => {
  it('giữ lại tâm trạng và ghi chú người dùng đã chọn', async () => {
    const row = { id: 'c1', userId: 'u1', status: 'INSUFFICIENT_DATA' };
    const prisma: any = {
      checkIn: {
        findFirst: jest.fn(async () => row),
        update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
      },
    };
    const service = new CheckinsService(prisma, {} as any, {} as any, {} as any, {} as any);
    const res: any = await service.respondToCheckin('u1', 'c1', { action: 'ACKNOWLEDGE', mood: 'GOOD', note: 'Tuần bận' } as any);
    expect(res.data.status).toBe('ACKNOWLEDGED');
    expect(res.data.mood).toBe('GOOD');
    expect(res.data.note).toBe('Tuần bận');
  });

  it('không chọn tâm trạng thì không ghi đè bằng rỗng', async () => {
    const row = { id: 'c1', userId: 'u1', status: 'INSUFFICIENT_DATA' };
    const prisma: any = {
      checkIn: {
        findFirst: jest.fn(async () => row),
        update: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
      },
    };
    const service = new CheckinsService(prisma, {} as any, {} as any, {} as any, {} as any);
    await service.respondToCheckin('u1', 'c1', { action: 'ACKNOWLEDGE' } as any);
    const data = prisma.checkIn.update.mock.calls[0][0].data;
    expect('mood' in data).toBe(false);
    expect('note' in data).toBe(false);
  });
});
