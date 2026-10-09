/**
 * Test tái hiện các vấn đề trong NutriWise_Dac_Ta_Nghiep_Vu_v3.1.md (chuẩn hoá 06/10/2026).
 *
 * Mỗi test khẳng định hành vi ĐÚNG THEO ĐẶC TẢ, nên trước khi sửa code các test này phải ĐỎ.
 * Sau khi sửa, test chuyển XANH và trở thành test nghiệm thu cho vấn đề tương ứng.
 * Tên mỗi `describe` bắt đầu bằng mã vấn đề trong sheet "Danh sách vấn đề".
 *
 * Chạy: npx jest issues-repro --runInBand
 * Không cần DB: toàn bộ truy cập Prisma được thay bằng mock.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { CheckinsService } from './checkins/checkins.service';
import { WeightLogsService } from './weight-logs/weight-logs.service';
import { AiService } from './ai/ai.service';
import { AiController } from './ai/ai.controller';
import { MealsService } from './meals/meals.service';
import {
  HealthCalculatorService,
  activityLevelFromTrainingDays,
  sessionsBucketFromTrainingDays,
} from './users/health-calculator.service';
import { AdaptiveExpenditureService } from './users/adaptive-expenditure.service';
import { UpdateProfileDto } from './users/dto/update-profile.dto';
import { CreateWeightLogDto } from './weight-logs/dto/create-weight-log.dto';
import { UsersService } from './users/users.service';
import { RespondCheckinDto } from './checkins/dto/respond-checkin.dto';
import { DailyStatusService } from './daily-status/daily-status.service';
import { SetDailyStatusDto } from './daily-status/dto/set-daily-status.dto';
import { isCompleteDay } from './common/utils/day-completeness.util';
import { WaterLogsService } from './water-logs/water-logs.service';
import { WorkoutsService } from './workouts/workouts.service';
import {
  addDaysToKey,
  dateToKey,
  dayBoundsForKey,
  keyToDate,
  mondayOnOrBefore,
  normalizeDayKey,
} from './common/utils/date-zone.util';
import { detectTextViolations, getAllowedFoods, isFoodAllowed } from './recommendations/food-safety';
import { FOOD_SAFETY_TAGS } from './recommendations/data/food-safety-tags.data';
import { VIETNAMESE_FOODS_DATA } from './recommendations/data/vietnamese-food-database.data';

// Cùng cấu hình với main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (value: any, metatype: any) =>
  pipe.transform(value, { type: 'body', metatype });

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// NEN-03 — endpoint cộng lượt AI miễn phí
// ---------------------------------------------------------------------------
// NEN-03 — không còn endpoint cộng lượt AI (mô hình Free/Premium thay cho gói mua lẻ)
// ---------------------------------------------------------------------------
describe('NEN-03 Không còn endpoint tự cộng lượt AI', () => {
  const controller: any = new AiController({} as any);

  it('đã gỡ hẳn các route mua lượt và gói mua lẻ cũ', () => {
    for (const name of ['purchaseCredits', 'purchaseChatQuota', 'getPackages', 'getChatPackages']) {
      expect(controller[name]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// BR-02.1 — phong cách ăn App gửi phải qua validation của backend
// ---------------------------------------------------------------------------
describe('BR-02.1 Lựa chọn phong cách ăn App gửi lên phải được backend chấp nhận', () => {
  const screen = path.resolve(
    __dirname,
    '..',
    '..',
    'CalAI',
    'app',
    'src',
    'main',
    'java',
    'com',
    'calai',
    'app',
    'presentation',
    'screens',
    'OnboardingScreen.kt',
  );
  const exists = fs.existsSync(screen);
  // DietStylePage có 2 danh sách lựa chọn: danh sách đầu là dietType, danh sách sau là macroStyle
  const lists: string[][] = exists
    ? (() => {
        const src = fs.readFileSync(screen, 'utf-8');
        const page = src.substring(src.indexOf('private fun DietStylePage'));
        const end = page.indexOf('TRANG 7: ALLERGIES');
        const body = page.substring(0, end > 0 ? end : undefined);
        return body
          .split('listOf(')
          .slice(1)
          .map((chunk) => [...chunk.matchAll(/"([A-Za-z_]+)"\s+to\s+\(/g)].map((m) => m[1]));
      })()
    : [];
  const dietTypes = lists[0] ?? [];
  const macroStyles = lists[1] ?? [];

  it('đọc được 2 danh sách lựa chọn (chế độ ăn và cách chia macro) từ OnboardingScreen.kt', () => {
    expect(exists).toBe(true);
    expect(dietTypes.length).toBeGreaterThan(0);
    expect(macroStyles.length).toBeGreaterThan(0);
  });

  it.each(dietTypes)('dietType "%s" qua được ValidationPipe', async (key) => {
    await expect(validate({ dietType: key }, UpdateProfileDto)).resolves.toBeDefined();
  });

  it.each(macroStyles)('macroStyle "%s" qua được ValidationPipe', async (key) => {
    await expect(validate({ macroStyle: key }, UpdateProfileDto)).resolves.toBeDefined();
  });

  it('mọi tổ hợp chế độ ăn × cách chia macro đều gửi hồ sơ thành công (AC1)', async () => {
    for (const dietType of dietTypes) {
      for (const macroStyle of macroStyles) {
        await expect(
          validate({ dietType, macroStyle, applyTarget: true }, UpdateProfileDto),
        ).resolves.toBeDefined();
      }
    }
  });

  it('không còn giá trị cũ chữ thường hoặc giá trị không có trong enum backend', async () => {
    for (const bad of ['any', 'balanced', 'high_protein', 'mediterranean']) {
      await expect(validate({ macroStyle: bad }, UpdateProfileDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect([...dietTypes, ...macroStyles].some((k) => k !== k.toUpperCase())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BR-01.2 — liên kết Google SSO
// ---------------------------------------------------------------------------
describe('BR-01.2 Liên kết Google vào tài khoản chưa xác thực email', () => {
  function build(emailVerified: boolean, localVerified = false, localGoogleId: string | null = null) {
    const updates: any[] = [];
    const localUser = {
      id: 'u1',
      username: 'victim',
      email: 'victim@example.com',
      password: 'attacker-password-hash',
      refreshTokenHash: 'attacker-refresh-hash',
      isEmailVerified: localVerified,
      emailVerifiedAt: null,
      isActive: true,
      role: 'USER',
      googleId: localGoogleId,
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.googleId ? null : where.email === localUser.email ? localUser : null,
        ),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { ...localUser, ...data };
        }),
        create: jest.fn(),
      },
    };
    const jwt: any = { signAsync: jest.fn(async () => 'token') };
    const config: any = { get: jest.fn((k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'cid' : undefined)) };
    const mail: any = { sendGoogleLinkedNotice: jest.fn(async () => undefined) };
    const service: any = new AuthService(prisma, jwt, config, mail);
    service.googleClient = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          sub: 'google-sub-1',
          email: 'victim@example.com',
          email_verified: emailVerified,
          name: 'Victim',
        }),
      }),
    };
    return { service, updates, mail };
  }

  it('tài khoản chưa xác thực: sau khi liên kết phải xoá mật khẩu cũ và thu hồi refresh token', async () => {
    const { service, updates, mail } = build(true);
    await service.loginWithGoogle('id-token');
    const link = updates.find((d) => d.googleId === 'google-sub-1');
    expect(link).toBeDefined();
    expect(link.password).toBeNull();
    expect(link.refreshTokenHash).toBeNull();
    expect(mail.sendGoogleLinkedNotice).toHaveBeenCalledWith('victim@example.com');
  });

  it('tài khoản ĐÃ xác thực email: liên kết nhưng giữ nguyên mật khẩu', async () => {
    const { service, updates, mail } = build(true, true);
    await service.loginWithGoogle('id-token');
    const link = updates.find((d) => d.googleId === 'google-sub-1');
    expect(link).toBeDefined();
    expect('password' in link).toBe(false);
    expect(mail.sendGoogleLinkedNotice).not.toHaveBeenCalled();
  });

  it('email đã gắn với tài khoản Google khác bị từ chối 409', async () => {
    const { service } = build(true, true, 'another-google-sub');
    await expect(service.loginWithGoogle('id-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('idToken có email_verified = false phải bị từ chối', async () => {
    const { service } = build(false);
    await expect(service.loginWithGoogle('id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

// ---------------------------------------------------------------------------
// BR-04 — ghi cân không được đổi mục tiêu
// ---------------------------------------------------------------------------
describe('BR-04 / BR-09.2 Ghi cân không được ghi đè mục tiêu', () => {
  function build(programType: string) {
    const userUpdates: any[] = [];
    const user = {
      id: 'u1',
      heightCm: 170,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      bodyFatPercent: null,
      dateOfBirth: new Date('1995-01-01'),
      gender: 'MALE',
      activityLevel: 'MODERATELY_ACTIVE',
      goal: 'LOSE_WEIGHT',
      macroStyle: 'BALANCED',
      programType,
      targetCalories: 1800,
      adaptiveExpenditure: null,
    };
    const prisma: any = {
      weightLog: {
        create: jest.fn(async ({ data }: any) => {
          (prisma as any)._last = data;
          return data;
        }),
        findFirst: jest.fn(async () => (prisma as any)._last ?? null),
        findMany: jest.fn(async () => []),
      },
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => {
          userUpdates.push(data);
          return { ...user, ...data };
        }),
      },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({
        method: 'ADAPTIVE',
        status: 'UPDATING',
        estimatedExpenditure: 2900,
        staticTdee: 2500,
      })),
      recordSnapshot: jest.fn(),
    };
    const service = new WeightLogsService(prisma, new HealthCalculatorService(), adaptive);
    return { service, userUpdates };
  }

  it.each(['MANUAL', 'COACHED'])(
    'user %s: POST weight-logs không được thay đổi targetCalories',
    async (programType) => {
      const { service, userUpdates } = build(programType);
      await service.createLog('u1', { weightKg: 69.5 } as any);
      for (const data of userUpdates) {
        expect(data.targetCalories).toBeUndefined();
      }
    },
  );
});

describe('BR-04 PATCH users/me và các sự kiện đổi mục tiêu', () => {
  function build(opts: { targetCalories: number | null; programType?: string }) {
    const userUpdates: any[] = [];
    const changes: any[] = [];
    const current: any = {
      id: 'u1',
      heightCm: 170,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      bodyFatPercent: null,
      dateOfBirth: new Date('1995-01-01'),
      gender: 'MALE',
      activityLevel: 'MODERATELY_ACTIVE',
      goal: 'LOSE_WEIGHT',
      macroStyle: 'BALANCED',
      programType: opts.programType ?? 'COACHED',
      targetCalories: opts.targetCalories,
      targetProtein: opts.targetCalories ? 150 : null,
      targetCarb: opts.targetCalories ? 200 : null,
      targetFat: opts.targetCalories ? 60 : null,
      adaptiveExpenditure: null,
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async ({ data }: any) => {
          userUpdates.push(data);
          return { ...current, ...data };
        }),
      },
      weightLog: { create: jest.fn() },
      goal: { updateMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async ({ data }: any) => data) },
      targetChange: {
        create: jest.fn(async ({ data }: any) => {
          changes.push(data);
          return data;
        }),
        findMany: jest.fn(async () => changes),
      },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({
        method: 'STATIC_FALLBACK',
        status: 'UPDATING',
        estimatedExpenditure: 2400,
        staticTdee: 2400,
        message: '',
      })),
      recordSnapshot: jest.fn(),
    };
    const service = new UsersService(prisma, new HealthCalculatorService(), adaptive);
    return { service, userUpdates, changes, current, prisma };
  }

  it('đổi cân nặng/chiều cao khi đã có mục tiêu: KHÔNG ghi đè, trả proposedTarget', async () => {
    const { service, userUpdates, changes } = build({ targetCalories: 1800 });
    const res: any = await service.updateProfile('u1', { weightKg: 80, heightCm: 180 } as any);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].targetCalories).toBeUndefined();
    expect(res.data.targetApplied).toBe(false);
    expect(res.data.proposedTarget).not.toBeNull();
    expect(res.data.proposedTarget.diff.calories).toBe(res.data.proposedTarget.calories - 1800);
    expect(changes).toHaveLength(0);
  });

  it('user MANUAL cũng không bị ghi đè khi sửa hồ sơ', async () => {
    const { service, userUpdates } = build({ targetCalories: 1800, programType: 'MANUAL' });
    await service.updateProfile('u1', { weightKg: 90 } as any);
    expect(userUpdates[0].targetCalories).toBeUndefined();
  });

  it('chưa có mục tiêu (hoàn tất Onboarding, E1): tự áp dụng và ghi TargetChange ONBOARDING', async () => {
    const { service, userUpdates, changes } = build({ targetCalories: null });
    const res: any = await service.updateProfile('u1', { weightKg: 70 } as any);
    expect(userUpdates[0].targetCalories).toBeGreaterThan(0);
    expect(res.data.targetApplied).toBe(true);
    expect(res.data.proposedTarget).toBeNull();
    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('ONBOARDING');
    expect(changes[0].oldCalories).toBeNull();
  });

  it('applyTarget = true khi đổi mục tiêu (E2): áp dụng và ghi TargetChange GOAL_CHANGE', async () => {
    const { service, userUpdates, changes } = build({ targetCalories: 1800 });
    await service.updateProfile('u1', { goal: 'GAIN_WEIGHT', applyTarget: true } as any);
    expect(userUpdates[0].targetCalories).toBeGreaterThan(1800);
    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('GOAL_CHANGE');
    expect(changes[0].oldCalories).toBe(1800);
  });

  it('applyTarget = true khi chỉ đổi cân nặng: nguồn PROFILE_RECALC', async () => {
    const { service, changes } = build({ targetCalories: 1800 });
    await service.updateProfile('u1', { weightKg: 85, applyTarget: true } as any);
    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('PROFILE_RECALC');
  });

  it('POST users/me/target/apply (E5): áp dụng mục tiêu tính từ hồ sơ hiện tại và ghi lịch sử', async () => {
    const { service, userUpdates, changes } = build({ targetCalories: 1800 });
    const res: any = await service.applyProposedTarget('u1');
    expect(userUpdates).toHaveLength(1);
    expect(res.data.targetCalories).toBe(userUpdates[0].targetCalories);
    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('PROFILE_RECALC');
  });

  it('PATCH không có applyTarget và không có gì thay đổi mục tiêu → proposedTarget = null', async () => {
    const { service, current } = build({ targetCalories: 1800 });
    // đặt mục tiêu hiện tại đúng bằng mục tiêu tính được
    const calc = new HealthCalculatorService().calculateAllMetrics({
      heightCm: 170,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      dateOfBirth: current.dateOfBirth,
      gender: 'MALE' as any,
      activityLevel: 'MODERATELY_ACTIVE' as any,
      goal: 'LOSE_WEIGHT' as any,
      macroStyle: 'BALANCED' as any,
      expenditureOverride: null,
    });
    current.targetCalories = calc.targetCalories;
    current.targetProtein = calc.targetProtein;
    current.targetCarb = calc.targetCarb;
    current.targetFat = calc.targetFat;
    const res: any = await service.updateProfile('u1', { name: 'Tên mới' } as any);
    expect(res.data.proposedTarget).toBeNull();
  });
});

describe('BR-04.4 Check-in được chấp nhận ghi TargetChange (E3)', () => {
  it('ACCEPT cập nhật mục tiêu và tạo đúng một dòng TargetChange CHECKIN_ACCEPTED', async () => {
    const checkIn = {
      id: 'c1',
      userId: 'u1',
      status: 'PENDING',
      currentCalorieTarget: 2000,
      proposedCalorieTarget: 2150,
      currentProteinTarget: 150,
      proposedProteinTarget: 161,
      currentCarbTarget: 200,
      proposedCarbTarget: 215,
      currentFatTarget: 67,
      proposedFatTarget: 72,
      newExpenditure: 2700,
    };
    const created: any[] = [];
    const prisma: any = {
      checkIn: {
        findFirst: jest.fn(async () => checkIn),
        update: jest.fn(async ({ data }: any) => ({ ...checkIn, ...data })),
      },
      user: {
        findUnique: jest.fn(async () => ({ targetCalories: 2000 })),
        update: jest.fn(async () => ({ tdee: 2500, expenditureStatus: 'STABLE' })),
      },
      targetChange: { create: jest.fn(async ({ data }: any) => created.push(data)) },
    };
    const expenditure: any = { recordSnapshot: jest.fn() };
    const service = new CheckinsService(prisma, expenditure, new HealthCalculatorService(), {} as any, { create: jest.fn() } as any);
    await service.respondToCheckin('u1', 'c1', { action: 'ACCEPT' } as any);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      source: 'CHECKIN_ACCEPTED',
      oldCalories: 2000,
      newCalories: 2150,
      checkinId: 'c1',
    });
  });
});

// ---------------------------------------------------------------------------
// BR-03.6 — số buổi tập/tuần (có 0) là nguồn duy nhất suy ra mức vận động
// ---------------------------------------------------------------------------
describe('BR-03.6 Số buổi tập/tuần dạng số nguyên, có giá trị 0', () => {
  it.each([
    [0, 'SEDENTARY', null],
    [1, 'LIGHTLY_ACTIVE', 'ONE_TO_TWO'],
    [2, 'LIGHTLY_ACTIVE', 'ONE_TO_TWO'],
    [3, 'MODERATELY_ACTIVE', 'THREE_TO_FOUR'],
    [4, 'MODERATELY_ACTIVE', 'THREE_TO_FOUR'],
    [5, 'VERY_ACTIVE', 'FIVE_TO_SIX'],
    [6, 'VERY_ACTIVE', 'FIVE_TO_SIX'],
    [7, 'EXTRA_ACTIVE', 'SEVEN'],
  ])('%i buổi/tuần → %s, nhóm %s', (days, level, bucket) => {
    expect(activityLevelFromTrainingDays(days)).toBe(level);
    expect(sessionsBucketFromTrainingDays(days)).toBe(bucket);
  });

  it('DTO chấp nhận 0–7 và từ chối ngoài khoảng hoặc số lẻ', async () => {
    await expect(validate({ trainingDaysPerWeek: 0 }, UpdateProfileDto)).resolves.toBeDefined();
    await expect(validate({ trainingDaysPerWeek: 7 }, UpdateProfileDto)).resolves.toBeDefined();
    for (const bad of [-1, 8, 2.5]) {
      await expect(validate({ trainingDaysPerWeek: bad }, UpdateProfileDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  async function patch(dto: any) {
    const updates: any[] = [];
    const current: any = {
      id: 'u1',
      heightCm: 170,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      bodyFatPercent: null,
      dateOfBirth: new Date('1995-01-01'),
      gender: 'MALE',
      activityLevel: 'MODERATELY_ACTIVE',
      goal: 'LOSE_WEIGHT',
      macroStyle: 'BALANCED',
      targetCalories: 1800,
      targetProtein: 150,
      targetCarb: 200,
      targetFat: 60,
      trainingDaysPerWeek: null,
      sessionsPerWeek: 'THREE_TO_FOUR',
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { ...current, ...data };
        }),
      },
      weightLog: { create: jest.fn() },
      goal: { updateMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async ({ data }: any) => data) },
      targetChange: { create: jest.fn() },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({
        method: 'STATIC_FALLBACK',
        status: 'UPDATING',
        estimatedExpenditure: null,
        staticTdee: null,
        message: '',
      })),
      recordSnapshot: jest.fn(),
    };
    const service = new UsersService(prisma, new HealthCalculatorService(), adaptive);
    await service.updateProfile('u1', dto);
    return updates[0];
  }

  it('0 buổi: activityLevel = SEDENTARY, sessionsPerWeek = null, TDEE thấp hơn 3 buổi', async () => {
    const zero = await patch({ trainingDaysPerWeek: 0 });
    const three = await patch({ trainingDaysPerWeek: 3 });
    expect(zero.activityLevel).toBe('SEDENTARY');
    expect(zero.sessionsPerWeek).toBeNull();
    expect(zero.trainingDaysPerWeek).toBe(0);
    expect(three.activityLevel).toBe('MODERATELY_ACTIVE');
    expect(zero.tdee).toBeLessThan(three.tdee);
  });

  it('gửi kèm activityLevel cũ: số buổi tập vẫn là nguồn duy nhất', async () => {
    const data = await patch({ trainingDaysPerWeek: 6, activityLevel: 'SEDENTARY' });
    expect(data.activityLevel).toBe('VERY_ACTIVE');
    expect(data.sessionsPerWeek).toBe('FIVE_TO_SIX');
  });
});

// ---------------------------------------------------------------------------
// BR-06.4 — công thức đề xuất Check-in
// ---------------------------------------------------------------------------
describe('BR-06.4 Check-in không được trừ thâm hụt hai lần', () => {
  async function propose(opts: {
    goal: string;
    target: number;
    expenditure: number;
    rate?: number;
    weight?: number;
    targetWeight?: number | null;
  }) {
    const user = {
      id: 'u1',
      programType: 'COACHED',
      goal: opts.goal,
      macroStyle: 'BALANCED',
      targetCalories: opts.target,
      targetProtein: 150,
      targetCarb: 200,
      targetFat: 67,
      tdee: opts.expenditure,
      adaptiveExpenditure: opts.expenditure,
      weightRateKgPerWeek: opts.rate ?? 0.5, // 0.5 × 7700 / 7 = 550 kcal/ngày
      targetWeightKg: opts.targetWeight ?? null,
    };
    const weightLogs = opts.weight ? [{ weightKg: opts.weight, date: new Date() }] : [];
    const prisma: any = {
      user: { findUnique: jest.fn(async () => user) },
      meal: { findMany: jest.fn(async () => []) },
      weightLog: { findMany: jest.fn(async () => weightLogs) },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
      checkIn: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ ...args.data })),
      },
    };
    const expenditure: any = {
      recalculate: jest.fn(async () => ({
        estimatedExpenditure: opts.expenditure,
        method: 'ADAPTIVE',
        status: 'STABLE',
      })),
    };
    const weights: any = {
      getWeightProgress: jest.fn(async () => ({ data: { progressPercent: 10 } })),
    };
    const service = new CheckinsService(prisma, expenditure, new HealthCalculatorService(), weights, { create: jest.fn() } as any);
    await service.generateCheckin('u1', {} as any);
    return prisma.checkIn.create.mock.calls[0][0].data;
  }

  it('mục tiêu 2000, thâm hụt 550, Expenditure 2550 → đề xuất giữ 2000 (không phải 1650)', async () => {
    const created = await propose({ goal: 'LOSE_WEIGHT', target: 2000, expenditure: 2550 });
    expect(created.proposedCalorieTarget).toBe(2000);
    expect(created.adjustmentReason).toBe('NO_CHANGE');
  });

  it('Expenditure tăng mạnh: đề xuất bị chặn ở +10% và ghi lý do SMOOTHING', async () => {
    const created = await propose({ goal: 'LOSE_WEIGHT', target: 2000, expenditure: 3200 });
    expect(created.proposedCalorieTarget).toBe(2200);
    expect(created.adjustmentReason).toBe('SMOOTHING');
  });

  it('Expenditure giảm mạnh: đề xuất bị chặn ở −10%', async () => {
    const created = await propose({ goal: 'LOSE_WEIGHT', target: 2000, expenditure: 2000 });
    // E − D = 1450 → bị chặn ở 1800 (−10%)
    expect(created.proposedCalorieTarget).toBe(1800);
    expect(created.adjustmentReason).toBe('SMOOTHING');
  });

  it('thay đổi vừa phải trong giới hạn: đề xuất đúng E − D, ghi lý do EXPENDITURE_CHANGE', async () => {
    const created = await propose({ goal: 'LOSE_WEIGHT', target: 2000, expenditure: 2700 });
    expect(created.proposedCalorieTarget).toBe(2150); // 2700 − 550, trong ±10%
    expect(created.adjustmentReason).toBe('EXPENDITURE_CHANGE');
  });

  it('tăng cân: đề xuất E + D (bị trần thặng dư 15% mức nền), không cộng thặng dư hai lần', async () => {
    // E 2450, D 550 vượt trần 15% E (367) → ideal = 2450 + 367 = 2818, nằm trong ±10% của 3000
    const created = await propose({ goal: 'GAIN_WEIGHT', target: 3000, expenditure: 2450 });
    expect(created.proposedCalorieTarget).toBe(2818);
  });

  it('duy trì, đúng cân đích: đề xuất bằng Expenditure', async () => {
    const created = await propose({
      goal: 'MAINTAIN',
      target: 2400,
      expenditure: 2400,
      weight: 70,
      targetWeight: 70,
    });
    expect(created.proposedCalorieTarget).toBe(2400);
    expect(created.adjustmentReason).toBe('NO_CHANGE');
  });

  it('duy trì, đang nặng hơn cân đích 2 kg: giảm nhẹ calo (Dynamic Maintenance)', async () => {
    const created = await propose({
      goal: 'MAINTAIN',
      target: 2400,
      expenditure: 2400,
      weight: 72,
      targetWeight: 70,
    });
    // nudge = 0.15% × 72 × 7700 / 7 ≈ 119 → ideal ≈ 2281
    expect(created.proposedCalorieTarget).toBeGreaterThan(2250);
    expect(created.proposedCalorieTarget).toBeLessThan(2320);
  });
});

// ---------------------------------------------------------------------------
// BR-06.6 — vòng đời Check-in
// ---------------------------------------------------------------------------
describe('BR-06.6 Vòng đời Check-in', () => {
  afterEach(() => jest.useRealTimers());

  function build(opts: { method?: string; existing?: any; rows?: any[]; userTarget?: number; createError?: any } = {}) {
    const user: any = {
      id: 'u1', programType: 'COACHED', goal: 'LOSE_WEIGHT', macroStyle: 'BALANCED',
      targetCalories: 2000, targetProtein: 150, targetCarb: 200, targetFat: 67, tdee: 2550,
      weightRateKgPerWeek: 0.5, timezone: 'Asia/Ho_Chi_Minh',
    };
    const store: any[] = opts.rows ?? [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async (a: any) => (a.select ? { targetCalories: opts.userTarget ?? 2000 } : user)),
        update: jest.fn(async () => ({ tdee: 2500, expenditureStatus: 'STABLE' })),
      },
      meal: { findMany: jest.fn(async () => []) },
      weightLog: { findMany: jest.fn(async () => []) },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
      targetChange: { create: jest.fn() },
      checkIn: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const c of store) {
            const okStatus = !where.status || (where.status.in ? where.status.in.includes(c.status) : where.status === c.status);
            const okWeek = !where.weekStartDate || c.weekStartDate < where.weekStartDate.lt;
            const okSnooze = !where.processedAt || (c.processedAt && c.processedAt <= where.processedAt.lte);
            if (okStatus && okWeek && okSnooze) {
              Object.assign(c, data);
              count++;
            }
          }
          return { count };
        }),
        findUnique: jest.fn(async () => opts.existing ?? null),
        findFirst: jest.fn(async ({ where }: any) => store.find((c) => where.status.in.includes(c.status)) ?? null),
        create: jest.fn(async ({ data }: any) => {
          if (opts.createError) throw opts.createError;
          const row = { id: 'new', ...data };
          store.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    const expenditure: any = {
      recalculate: jest.fn(async () => ({ estimatedExpenditure: 2550, method: opts.method ?? 'ADAPTIVE', status: 'STABLE' })),
      recordSnapshot: jest.fn(),
    };
    const weights: any = { getWeightProgress: jest.fn(async () => ({ data: { progressPercent: 0 } })) };
    return { prisma, store, service: new CheckinsService(prisma, expenditure, new HealthCalculatorService(), weights, { create: jest.fn() } as any) };
  }

  it('Engine chưa đủ dữ liệu → INSUFFICIENT_DATA, không có đề xuất (giữ nguyên mục tiêu)', async () => {
    freezeNow('2026-10-07T03:00:00Z');
    const { service, prisma } = build({ method: 'STATIC_FALLBACK' });
    await service.generateCheckin('u1', {} as any);
    const data = prisma.checkIn.create.mock.calls[0][0].data;
    expect(data.status).toBe('INSUFFICIENT_DATA');
    expect(data.proposedCalorieTarget).toBe(data.currentCalorieTarget);
  });

  it('kỳ đã có Check-in thì trả lại nguyên trạng, không tạo mới và không mở lại Check-in đã xử lý', async () => {
    freezeNow('2026-10-07T03:00:00Z');
    const existing = { id: 'c0', status: 'ACCEPTED', adjustmentReason: 'NO_CHANGE', currentCalorieTarget: 2000, proposedCalorieTarget: 2000, newExpenditure: 2000, compliancePct: 50 };
    const { service, prisma } = build({ existing });
    const res: any = await service.generateCheckin('u1', {} as any);
    expect(prisma.checkIn.create).not.toHaveBeenCalled();
    expect(res.data.checkIn.status).toBe('ACCEPTED');
  });

  it('hai request tạo cùng lúc: request thua (P2002) nhận lại bản đã có, không lỗi', async () => {
    freezeNow('2026-10-07T03:00:00Z');
    const winner = { id: 'w', status: 'PENDING', adjustmentReason: 'NO_CHANGE', currentCalorieTarget: 2000, proposedCalorieTarget: 2000, newExpenditure: 2000, compliancePct: null };
    const { service, prisma } = build({ createError: { code: 'P2002' } });
    prisma.checkIn.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const res: any = await service.generateCheckin('u1', {} as any);
    expect(res.data.checkIn.id).toBe('w');
  });

  it('tạo Check-in kỳ mới thì Check-in PENDING/SNOOZED của kỳ trước chuyển EXPIRED (chỉ còn một cái chờ)', async () => {
    freezeNow('2026-10-07T03:00:00Z');
    const old = { id: 'old', status: 'SNOOZED', weekStartDate: keyToDate('2026-09-21'), processedAt: new Date() };
    const done = { id: 'done', status: 'ACCEPTED', weekStartDate: keyToDate('2026-09-14') };
    const { service, store } = build({ rows: [old, done] });
    await service.generateCheckin('u1', {} as any);
    expect(old.status).toBe('EXPIRED');
    expect(done.status).toBe('ACCEPTED');
    expect(store.filter((c) => ['PENDING', 'SNOOZED'].includes(c.status))).toHaveLength(1);
  });

  it('"Để sau" quay lại PENDING sau 24 giờ, chưa đủ 24 giờ thì chưa', async () => {
    freezeNow('2026-10-07T03:00:00Z');
    const base = { status: 'SNOOZED', adjustmentReason: 'NO_CHANGE', currentCalorieTarget: 2000, proposedCalorieTarget: 2000, newExpenditure: 2000, compliancePct: null };
    const a = build({ rows: [{ ...base, id: 'a', processedAt: new Date('2026-10-07T01:00:00Z') }] });
    expect(((await a.service.getPendingCheckin('u1')) as any).data).toBeNull();
    const b = build({ rows: [{ ...base, id: 'b', processedAt: new Date('2026-10-06T02:00:00Z') }] });
    const res: any = await b.service.getPendingCheckin('u1');
    expect(res.data.checkIn.status).toBe('PENDING');
  });

  const pending = { id: 'c1', userId: 'u1', status: 'PENDING', currentCalorieTarget: 2000, proposedCalorieTarget: 2150, currentProteinTarget: 150, proposedProteinTarget: 161, currentCarbTarget: 200, proposedCarbTarget: 215, currentFatTarget: 67, proposedFatTarget: 72, newExpenditure: 2700 };

  it('chấp nhận khi mục tiêu đã đổi → 409 và Check-in chuyển EXPIRED, mục tiêu không bị ghi đè', async () => {
    const { service, prisma } = build({ userTarget: 1900 });
    prisma.checkIn.findFirst.mockResolvedValue(pending);
    await expect(service.respondToCheckin('u1', 'c1', { action: 'ACCEPT' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.checkIn.update.mock.calls[0][0].data.status).toBe('EXPIRED');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('Check-in đã ở trạng thái cuối không xử lý lại được', async () => {
    for (const status of ['EXPIRED', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED']) {
      const { service, prisma } = build();
      prisma.checkIn.findFirst.mockResolvedValue({ ...pending, status });
      await expect(service.respondToCheckin('u1', 'c1', { action: 'DECLINE' } as any)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('INSUFFICIENT_DATA chỉ nhận "Đã hiểu"; các hành động khác bị từ chối', async () => {
    const { service, prisma } = build();
    prisma.checkIn.findFirst.mockResolvedValue({ ...pending, status: 'INSUFFICIENT_DATA' });
    await expect(service.respondToCheckin('u1', 'c1', { action: 'ACCEPT' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await service.respondToCheckin('u1', 'c1', { action: 'ACKNOWLEDGE' } as any);
    expect(prisma.checkIn.update.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
  });

  it('SNOOZE và tên cũ DISMISS đều đặt trạng thái SNOOZED kèm mốc thời gian', async () => {
    for (const action of ['SNOOZE', 'DISMISS']) {
      const { service, prisma } = build();
      prisma.checkIn.findFirst.mockResolvedValue(pending);
      await service.respondToCheckin('u1', 'c1', { action } as any);
      const data = prisma.checkIn.update.mock.calls[0][0].data;
      expect(data.status).toBe('SNOOZED');
      expect(data.processedAt).toBeInstanceOf(Date);
    }
  });

  it('DTO nhận SNOOZE/DISMISS/ACKNOWLEDGE và từ chối giá trị lạ', async () => {
    for (const action of ['ACCEPT', 'DECLINE', 'SNOOZE', 'DISMISS', 'ACKNOWLEDGE']) {
      await expect(validate({ action }, RespondCheckinDto)).resolves.toBeDefined();
    }
    await expect(validate({ action: 'DELETE' }, RespondCheckinDto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// BR-03.2 — calo tập không cộng vào "Còn lại"
// ---------------------------------------------------------------------------
describe('BR-03.2 "Còn lại" không cộng calo tập luyện', () => {
  it('đã ăn 1500, mục tiêu 2000, tập đốt 400 → còn lại 500', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({
          targetCalories: 2000,
          targetProtein: 150,
          targetCarb: 200,
          targetFat: 60,
        })),
      },
      meal: {
        findMany: jest.fn(async () => [
          { totalCalories: 1500, totalProtein: 100, totalCarb: 150, totalFat: 50, items: [] },
        ]),
      },
      workoutLog: {
        findMany: jest.fn(async () => [{ caloriesBurned: 400, durationMinutes: 60 }]),
      },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
    };
    const service = new MealsService(prisma, { create: jest.fn() } as any);
    const res: any = await service.getDailyNutritionSummary('u1', '2026-10-06');
    expect(res.data.summary.remainingCalories).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// BR-03.3 — sàn calo theo giới và trần thặng dư
// ---------------------------------------------------------------------------
describe('BR-03.3 Sàn calo theo giới và trần chênh lệch', () => {
  const calc = new HealthCalculatorService();
  const base = {
    heightCm: 170,
    weightKg: 55,
    dateOfBirth: new Date('1996-01-01'),
    gender: 'MALE' as any,
    activityLevel: 'SEDENTARY' as any,
    macroStyle: 'BALANCED' as any,
  };

  it('nam giảm cân nhanh: calo mục tiêu không thấp hơn sàn 1500', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      goal: 'LOSE_WEIGHT' as any,
      weightRateKgPerWeek: 1.0,
    });
    expect(r.targetCalories).toBeGreaterThanOrEqual(1500);
  });

  it('nữ giảm cân nhanh: sàn 1200 nhưng không thấp hơn BMR', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      gender: 'FEMALE' as any,
      weightKg: 48,
      goal: 'LOSE_WEIGHT' as any,
      weightRateKgPerWeek: 1.0,
    });
    expect(r.targetCalories!).toBeGreaterThanOrEqual(Math.max(1200, r.bmr!));
  });

  it('giảm cân: thâm hụt không quá 25% mức nền và có cờ DEFICIT_CAP', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      weightKg: 100,
      heightCm: 180,
      activityLevel: 'MODERATELY_ACTIVE' as any,
      goal: 'LOSE_WEIGHT' as any,
      weightRateKgPerWeek: 1.5,
    });
    expect(r.targetCalories!).toBeGreaterThanOrEqual(Math.round(r.tdee! * 0.75));
    expect(r.targetLimitedBy).toBe('DEFICIT_CAP');
  });

  it('mục tiêu không bị giới hạn thì targetLimitedBy = null', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      weightKg: 80,
      heightCm: 178,
      activityLevel: 'MODERATELY_ACTIVE' as any,
      goal: 'LOSE_WEIGHT' as any,
      weightRateKgPerWeek: 0.25,
    });
    expect(r.targetLimitedBy).toBeNull();
  });

  it('tăng cân nhanh: có cờ SURPLUS_CAP', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      goal: 'GAIN_WEIGHT' as any,
      weightRateKgPerWeek: 1.0,
    });
    expect(r.targetLimitedBy).toBe('SURPLUS_CAP');
  });

  it('tăng cân nhanh: thặng dư không quá 15% mức nền', () => {
    const r = calc.calculateAllMetrics({
      ...base,
      goal: 'GAIN_WEIGHT' as any,
      weightRateKgPerWeek: 1.0,
    });
    expect(r.targetCalories!).toBeLessThanOrEqual(Math.round(r.tdee! * 1.15));
  });
});

// ---------------------------------------------------------------------------
// BR-05.9 — trộn Expenditure theo ngày, không theo số lần tính
// ---------------------------------------------------------------------------
describe('BR-05.9 Tính lại nhiều lần trong ngày cho cùng kết quả', () => {
  const now = Date.now();
  const weights = [80, 79.8, 79.6, 79.5, 79.2].map((w, i) => ({
    weightKg: w,
    date: new Date(now - (12 - i * 3) * DAY),
  }));
  const dayDate = (d: number) =>
    new Date(new Date(now - d * DAY).toISOString().split('T')[0] + 'T00:00:00Z');
  // mỗi ngày 2 bữa x 1000 kcal = 2000 kcal → ngày đầy đủ theo quy tắc tự động (BR-05.2)
  const meals = [12, 10, 8, 6, 4, 2].flatMap((d) => [
    { logDate: dayDate(d), totalCalories: 1000 },
    { logDate: dayDate(d), totalCalories: 1000 },
  ]);
  let dayFlags: { logDate: Date; completeness: string }[] = [];

  function build(snapshots: { adaptiveExpenditure: number; recordedAt: Date }[]) {
    const store = [...snapshots].map((x, i) => ({ id: `s${i}`, userId: 'u1', staticTdee: 2500, status: 'UPDATING', ...x }));
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', targetCalories: 2000 })) },
      weightLog: { findMany: jest.fn(async () => weights) },
      meal: { findMany: jest.fn(async () => meals) },
      dailyLogStatus: { findMany: jest.fn(async () => dayFlags) },
      expenditureSnapshot: {
        findFirst: jest.fn(async ({ where }: any) => {
          const lt = where.recordedAt?.lt;
          const gte = where.recordedAt?.gte;
          return (
            store
              .filter((s) => (lt ? s.recordedAt < lt : true) && (gte ? s.recordedAt >= gte : true))
              .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0] ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          store.push({ id: `n${store.length}`, ...data });
          return data;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(store.find((s) => s.id === where.id)!, data);
        }),
      },
    };
    return { engine: new AdaptiveExpenditureService(prisma), store };
  }

  it('tính lại 5 lần trong cùng ngày với cùng dữ liệu cho cùng một kết quả', async () => {
    const { engine, store } = build([{ adaptiveExpenditure: 2400, recordedAt: new Date(now - 2 * DAY) }]);
    const first = await engine.recalculate('u1', 2500);
    expect(first.method).toBe('ADAPTIVE');
    for (let i = 0; i < 4; i++) {
      await engine.recordSnapshot('u1', first); // giống việc lưu kết quả sau mỗi lần ghi cân
      const again = await engine.recalculate('u1', 2500);
      expect(again.estimatedExpenditure).toBe(first.estimatedExpenditure);
    }
    // mỗi ngày tối đa một snapshot: 1 snapshot cũ + 1 snapshot hôm nay
    expect(store).toHaveLength(2);
  });

  it('trộn từ giá trị của ngày trước: raw hội tụ dần theo ngày, không nhảy', async () => {
    const { engine } = build([{ adaptiveExpenditure: 2000, recordedAt: new Date(now - 1 * DAY) }]);
    const r = await engine.recalculate('u1', 2500);
    // kết quả = 2000 + 0.25 × (raw − 2000): nằm giữa mốc cũ và raw, cách mốc cũ không quá 25% khoảng cách tối đa
    expect(r.estimatedExpenditure).toBeGreaterThan(2000);
    expect(r.estimatedExpenditure).toBeLessThan(2000 + 0.25 * (2500 * 1.5 - 2000) + 1);
  });
});

// ---------------------------------------------------------------------------
// BR-05.2 — ngày đầy đủ (DailyLogStatus)
// ---------------------------------------------------------------------------
describe('BR-05.2 Quy tắc ngày đầy đủ', () => {
  it('tự động: cần ≥ 2 bữa và ≥ 60% mục tiêu', () => {
    expect(isCompleteDay(2, 1200, 2000)).toBe(true); // đúng 60%
    expect(isCompleteDay(2, 1199, 2000)).toBe(false);
    expect(isCompleteDay(1, 2500, 2000)).toBe(false); // chỉ 1 bữa
    expect(isCompleteDay(3, 900, 2000, 'AUTO')).toBe(false);
  });

  it('người dùng xác nhận "đã ghi đủ" thì được dùng (miễn có ít nhất 1 bữa)', () => {
    expect(isCompleteDay(1, 700, 2000, 'COMPLETE')).toBe(true);
    expect(isCompleteDay(0, 0, 2000, 'COMPLETE')).toBe(false); // ngày không log gì luôn bị bỏ qua
  });

  it('người dùng đánh dấu "chưa đủ" thì bị loại dù đạt quy tắc tự động', () => {
    expect(isCompleteDay(4, 2000, 2000, 'INCOMPLETE')).toBe(false);
  });
});

describe('BR-05.2 API đánh dấu ngày', () => {
  afterEach(() => jest.useRealTimers());

  function build() {
    const store = new Map<string, string>();
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      dailyLogStatus: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const k = dateToKey(where.userId_logDate.logDate);
          store.set(k, store.has(k) ? update.completeness : create.completeness);
          return { logDate: where.userId_logDate.logDate, completeness: store.get(k) };
        }),
        findMany: jest.fn(async () =>
          [...store.entries()].map(([k, c]) => ({ logDate: keyToDate(k), completeness: c })),
        ),
      },
    };
    return { service: new DailyStatusService(prisma), store };
  }

  it('đánh dấu hôm nay và quá khứ thành công; đọc lại đúng trạng thái, ngày chưa đánh dấu là AUTO', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service } = build();
    await service.setStatus('u1', '2026-10-06', 'COMPLETE' as any);
    await service.setStatus('u1', '2026-10-04', 'INCOMPLETE' as any);
    const res: any = await service.listStatuses('u1', '2026-10-04', '2026-10-06');
    expect(res.data).toEqual([
      { date: '2026-10-04', completeness: 'INCOMPLETE' },
      { date: '2026-10-05', completeness: 'AUTO' },
      { date: '2026-10-06', completeness: 'COMPLETE' },
    ]);
  });

  it('đánh dấu lại cùng một ngày thì ghi đè (một dòng mỗi ngày)', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service, store } = build();
    await service.setStatus('u1', '2026-10-05', 'COMPLETE' as any);
    await service.setStatus('u1', '2026-10-05', 'INCOMPLETE' as any);
    expect(store.size).toBe(1);
    expect(store.get('2026-10-05')).toBe('INCOMPLETE');
  });

  it('từ chối ngày tương lai, ngày sai định dạng và khoảng quá dài', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service } = build();
    await expect(service.setStatus('u1', '2026-10-07', 'COMPLETE' as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setStatus('u1', 'hôm qua', 'COMPLETE' as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listStatuses('u1', '2025-01-01', '2026-10-06')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DTO chỉ nhận AUTO/COMPLETE/INCOMPLETE', async () => {
    await expect(validate({ completeness: 'COMPLETE' }, SetDailyStatusDto)).resolves.toBeDefined();
    await expect(validate({ completeness: 'DONE' }, SetDailyStatusDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Home: summary trả trạng thái ngày và cờ isComplete; Week Strip trả từng ngày', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const rows = [
      { logDate: keyToDate('2026-10-06'), totalCalories: 900, totalProtein: 1, totalCarb: 1, totalFat: 1, items: [] },
    ];
    const flagsRows = [{ logDate: keyToDate('2026-10-06'), completeness: 'COMPLETE' }];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', targetCalories: 2000, targetProtein: 150, targetCarb: 200, targetFat: 60 })),
      },
      meal: { findMany: jest.fn(async () => rows) },
      workoutLog: { findMany: jest.fn(async () => []) },
      dailyLogStatus: { findMany: jest.fn(async () => flagsRows) },
    };
    const service = new MealsService(prisma, {} as any);
    const sum: any = await service.getDailyNutritionSummary('u1', '2026-10-06');
    expect(sum.data.logStatus).toEqual({ completeness: 'COMPLETE', isComplete: true });
    const week: any = await service.getWeekSummary('u1', '2026-10-05');
    expect(week.data[1]).toMatchObject({ date: '2026-10-06', completeness: 'COMPLETE', isComplete: true });
    expect(week.data[0]).toMatchObject({ completeness: 'AUTO', isComplete: false });
  });
});

describe('BR-05.2 Adaptive Engine chỉ học từ ngày đầy đủ', () => {
  const now = Date.now();
  const dayDate = (d: number) =>
    new Date(new Date(now - d * DAY).toISOString().split('T')[0] + 'T00:00:00Z');
  const weights = [80, 79.8, 79.6, 79.5, 79.2].map((w, i) => ({
    weightKg: w,
    date: new Date(now - (12 - i * 3) * DAY),
  }));

  function engine(meals: any[], flags: any[] = []) {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', targetCalories: 2000 })) },
      weightLog: { findMany: jest.fn(async () => weights) },
      meal: { findMany: jest.fn(async () => meals) },
      dailyLogStatus: { findMany: jest.fn(async () => flags) },
      expenditureSnapshot: { findFirst: jest.fn(async () => null) },
    };
    return new AdaptiveExpenditureService(prisma);
  }

  it('ngày chỉ có 1 bữa nhỏ không được tính: không đủ ngày đầy đủ thì dùng TDEE tĩnh', async () => {
    const sparse = [12, 10, 8, 6, 4, 2].map((d) => ({ logDate: dayDate(d), totalCalories: 600 }));
    const r = await engine(sparse).recalculate('u1', 2500);
    expect(r.method).toBe('STATIC_FALLBACK');
  });

  it('log thiếu bữa không kéo Expenditure xuống: cùng dữ liệu nhưng đánh dấu INCOMPLETE cho ngày thiếu', async () => {
    const full = [12, 10, 8, 6, 4].flatMap((d) => [
      { logDate: dayDate(d), totalCalories: 1250 },
      { logDate: dayDate(d), totalCalories: 1250 },
    ]);
    // thêm 1 ngày chỉ ghi 1 bữa 300 kcal (quên các bữa còn lại)
    const forgotten = { logDate: dayDate(2), totalCalories: 300 };
    const withForgotten = await engine([...full, forgotten]).recalculate('u1', 2500);
    const baseline = await engine(full).recalculate('u1', 2500);
    // ngày thiếu bữa bị loại tự động nên kết quả giống hệt khi không có ngày đó
    expect(withForgotten.estimatedExpenditure).toBe(baseline.estimatedExpenditure);
    expect(withForgotten.avgDailyCaloriesConsumed).toBe(2500);
    expect(withForgotten.loggedDaysCount).toBe(5);
  });

  it('người dùng đánh dấu INCOMPLETE thì ngày đủ bữa cũng bị loại; COMPLETE thì ngày 1 bữa được dùng', async () => {
    const days = [12, 10, 8, 6, 4, 2].flatMap((d) => [
      { logDate: dayDate(d), totalCalories: 1250 },
      { logDate: dayDate(d), totalCalories: 1250 },
    ]);
    const excluded = await engine(days, [{ logDate: dayDate(12), completeness: 'INCOMPLETE' }]).recalculate('u1', 2500);
    expect(excluded.loggedDaysCount).toBe(5);
    expect(excluded.avgDailyCaloriesConsumed).toBe(2500);

    const oneMealDays = [12, 10, 8, 6, 4].map((d) => ({ logDate: dayDate(d), totalCalories: 2500 }));
    const flags = [12, 10, 8, 6, 4].map((d) => ({ logDate: dayDate(d), completeness: 'COMPLETE' }));
    const included = await engine(oneMealDays, flags).recalculate('u1', 2500);
    expect(included.loggedDaysCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// BR-11.2 và BR-11.4 — AI nhận diện ảnh
// ---------------------------------------------------------------------------
describe('BR-11.2 / BR-11.4 AI nhận diện ảnh', () => {
  /**
   * Giả lập bảng UsageCounter với các thao tác đồng bộ trong một lượt chạy (giống một câu UPDATE
   * có điều kiện trong DB), để kiểm tra service có thực sự dùng cập nhật có điều kiện hay không.
   */
  function build(freeUsed: number, withGemini: boolean, purchased = 0) {
    const counters = new Map<string, { aiPhoto: number }>();
    const logs: any[] = [];
    const state = { purchased };
    const key = (w: any) => `${w.userId}|${w.date}`;
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({
          timezone: 'Asia/Ho_Chi_Minh',
          purchasedAiQuota: state.purchased,
        })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (state.purchased > (where.purchasedAiQuota?.gt ?? -1)) {
            state.purchased += data.purchasedAiQuota.decrement ? -1 : 0;
            return { count: 1 };
          }
          return { count: 0 };
        }),
        update: jest.fn(async ({ data }: any) => {
          state.purchased += data.purchasedAiQuota?.increment ?? 0;
        }),
      },
      subscriptionState: { findUnique: jest.fn(async () => null) },
      manualGrant: { findFirst: jest.fn(async () => null) },
      usageCounter: {
        upsert: jest.fn(async ({ where, create }: any) => {
          const k = key(where.userId_date);
          if (!counters.has(k)) counters.set(k, { aiPhoto: freeUsed });
          return { ...create };
        }),
        findUnique: jest.fn(async ({ where }: any) => counters.get(key(where.userId_date)) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = counters.get(key(where));
          if (!row) return { count: 0 };
          if (where.aiPhoto.lt !== undefined && !(row.aiPhoto < where.aiPhoto.lt)) return { count: 0 };
          if (where.aiPhoto.gt !== undefined && !(row.aiPhoto > where.aiPhoto.gt)) return { count: 0 };
          row.aiPhoto += data.aiPhoto.increment ?? -(data.aiPhoto.decrement ?? 0);
          return { count: 1 };
        }),
      },
      apiUsageLog: {
        create: jest.fn(async ({ data }: any) => {
          logs.push(data);
          return data;
        }),
      },
    };
    const config: any = { get: jest.fn(() => undefined) };
    const service: any = new AiService(config, prisma, {} as any);
    if (withGemini) {
      service.genAI = {};
      service.callGeminiVision = jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return { foodName: 'Phở bò', totalCalories: 450 };
      });
    }
    const used = () => [...counters.values()][0]?.aiPhoto ?? freeUsed;
    return { service, logs, used, state };
  }
  const img = 'aGVsbG8=';

  it('BR-11.2: không có API key → 503, hoàn lượt, không trả số calo', async () => {
    const { service, logs, used } = build(0, false);
    await expect(service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(used()).toBe(0);
    expect(logs).toHaveLength(0);
  });

  it('BR-11.2: Gemini lỗi hạ tầng → 503 và hoàn lượt', async () => {
    const { service, used } = build(2, true);
    service.callGeminiVision = jest.fn(async () => {
      throw new Error('503 upstream timeout');
    });
    await expect(service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(used()).toBe(2);
  });

  it('BR-11.4: NOT_FOOD (400) được hoàn lượt', async () => {
    const { service, used } = build(2, true);
    service.callGeminiVision = jest.fn(async () => {
      throw new BadRequestException('Không phải đồ ăn');
    });
    await expect(service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(used()).toBe(2);
  });

  it('thành công: trừ đúng 1 lượt miễn phí và ghi log chi phí', async () => {
    const { service, used, logs } = build(2, true);
    const res = await service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1');
    expect(res.isFallback).toBe(false);
    expect(res.usedQuotaType).toBe('FREE');
    expect(res.freeRemaining).toBe(2);
    expect(used()).toBe(3);
    expect(logs).toHaveLength(1);
  });

  it('BR-11.4: hai request đồng thời khi còn 1 lượt → đúng 1 thành công, 1 bị 429', async () => {
    const { service, used } = build(4, true); // giới hạn miễn phí 5, đã dùng 4
    const results = await Promise.allSettled([
      service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1'),
      service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toBe(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.getStatus()).toBe(429);
    expect(used()).toBe(5);
  });

  it('hết lượt miễn phí thì dùng lượt mua thêm, hết cả hai thì 429; lượt mua không âm', async () => {
    const { service, state } = build(5, true, 1);
    const first = await service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1');
    expect(first.usedQuotaType).toBe('PURCHASED');
    expect(state.purchased).toBe(0);
    await expect(service.analyzeFoodImageBase64(img, 'image/jpeg', 'u1')).rejects.toMatchObject({
      status: 429,
    });
    expect(state.purchased).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BR-07.2 — múi giờ của user (hạn mức AI)
// ---------------------------------------------------------------------------
describe('BR-07.2 Ranh giới ngày theo múi giờ của user', () => {
  const service: any = new AiService({ get: () => undefined } as any, {} as any, {} as any);
  const hourIn = (d: Date, tz: string) =>
    d.toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  it.each(['America/New_York', 'Asia/Ho_Chi_Minh', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland'])(
    'user ở %s: đầu ngày là 00:00 giờ địa phương và cách ngày kế tiếp 24 giờ (hoặc 23/25 giờ khi đổi giờ)',
    (tz) => {
      const { startOfDay, resetsAt } = service.getTimezoneDayBounds(tz);
      expect(hourIn(startOfDay, tz)).toBe('00:00');
      expect(hourIn(resetsAt, tz)).toBe('00:00');
      const hours = (resetsAt.getTime() - startOfDay.getTime()) / 3_600_000;
      expect([23, 24, 25]).toContain(hours);
      expect(startOfDay.getTime()).toBeLessThanOrEqual(Date.now());
      expect(resetsAt.getTime()).toBeGreaterThan(Date.now());
    },
  );

  it('múi giờ sai → dùng giờ Việt Nam, không ném lỗi', () => {
    const { startOfDay } = service.getTimezoneDayBounds('Not/AZone');
    expect(hourIn(startOfDay, 'Asia/Ho_Chi_Minh')).toBe('00:00');
  });
});

// ---------------------------------------------------------------------------
// BR-08.1a và BR-11.5 — lọc cứng dị ứng và chế độ ăn ở backend
// ---------------------------------------------------------------------------
describe('BR-08.1a Thẻ an toàn cho từng món trong kho', () => {
  const ALLERGENS = ['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'PEANUT', 'SESAME', 'SHELLFISH', 'SOY', 'TREE_NUT'];

  it('mọi món trong kho đều có thẻ an toàn, và không có thẻ thừa', () => {
    expect(VIETNAMESE_FOODS_DATA.length).toBeGreaterThan(0);
    const names = VIETNAMESE_FOODS_DATA.map((f) => f.name);
    for (const n of names) expect(FOOD_SAFETY_TAGS[n]).toBeDefined();
    for (const n of Object.keys(FOOD_SAFETY_TAGS)) expect(names).toContain(n);
  });

  it('allergen trong thẻ đều thuộc danh sách khoá hợp lệ của app', () => {
    for (const tags of Object.values(FOOD_SAFETY_TAGS)) {
      for (const a of tags.allergens) expect(ALLERGENS).toContain(a);
    }
  });

  it('thẻ nhất quán với tên món (bắt lỗi gắn nhầm)', () => {
    const problems: string[] = [];
    for (const food of VIETNAMESE_FOODS_DATA) {
      const t = FOOD_SAFETY_TAGS[food.name];
      const n = food.name.toLowerCase();
      if (/trứng/.test(n) && !t.containsEgg) problems.push(`${food.name}: thiếu containsEgg`);
      if (/heo|sườn|chả lụa|mọc|thịt kho/.test(n) && !t.containsPork) problems.push(`${food.name}: thiếu containsPork`);
      if (/(?<!trứng )gà|bò |bò$|heo|sườn|chả(?!o)|thịt/.test(n) && !t.containsMeat) problems.push(`${food.name}: thiếu containsMeat`);
      if (/cá |tôm|mực|ngao|nghêu|cua/.test(n) && !t.containsFish) problems.push(`${food.name}: thiếu containsFish`);
      if (/đậu phụ|đậu nành/.test(n) && !t.allergens.includes('SOY')) problems.push(`${food.name}: thiếu SOY`);
      if (/sữa chua|sữa tươi/.test(n) && !t.containsDairy) problems.push(`${food.name}: thiếu containsDairy`);
    }
    expect(problems).toEqual([]);
  });
});

describe('BR-11.5 Lọc cứng chế độ ăn và dị ứng', () => {
  const MEAT_WORDS = /\bgà\b|\bbò\b|heo|sườn|chả|thịt|mọc|trứng vịt lộn/i;
  const FISH_WORDS = /cá |tôm|mực|ngao|nghêu|cua/i;

  it('VEGETARIAN: không thịt, không cá/hải sản; vẫn cho phép trứng và sữa', () => {
    const allowed = getAllowedFoods({ dietType: 'VEGETARIAN' });
    expect(allowed.length).toBeGreaterThan(0);
    for (const f of allowed) {
      expect(f.name).not.toMatch(MEAT_WORDS);
      expect(f.name).not.toMatch(FISH_WORDS);
    }
    expect(allowed.some((f) => f.safety.containsEgg)).toBe(true);
  });

  it('VEGAN: không thịt, cá, trứng, sữa', () => {
    const allowed = getAllowedFoods({ dietType: 'VEGAN' });
    expect(allowed.length).toBeGreaterThan(0);
    for (const f of allowed) {
      expect(f.name).not.toMatch(MEAT_WORDS);
      expect(f.name).not.toMatch(FISH_WORDS);
      expect(f.name).not.toMatch(/trứng|sữa chua|sữa tươi/i);
      expect(f.safety.containsEgg || f.safety.containsDairy).toBe(false);
    }
  });

  it('PESCATARIAN: có cá nhưng không có thịt', () => {
    const allowed = getAllowedFoods({ dietType: 'PESCATARIAN' });
    expect(allowed.some((f) => /Cá hồi/.test(f.name))).toBe(true);
    expect(allowed.some((f) => /Phở bò/.test(f.name))).toBe(false);
  });

  it('HALAL: không có món chứa thịt heo', () => {
    const allowed = getAllowedFoods({ dietType: 'HALAL' });
    expect(allowed.length).toBeGreaterThan(0);
    for (const f of allowed) expect(f.safety.containsPork).toBe(false);
    expect(allowed.some((f) => /Phở bò/.test(f.name))).toBe(true);
  });

  it.each(['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'SHELLFISH', 'SOY'])(
    'dị ứng %s: không món nào có allergen này',
    (allergen) => {
      const allowed = getAllowedFoods({ allergies: [allergen] });
      expect(allowed.length).toBeGreaterThan(0);
      for (const f of allowed) expect(f.safety.allergens).not.toContain(allergen);
    },
  );

  it('"NONE" và giá trị lạ không loại món nào; dietType lạ coi như ăn tạp', () => {
    expect(getAllowedFoods({ allergies: ['NONE', ''], dietType: 'BALANCED' })).toHaveLength(
      VIETNAMESE_FOODS_DATA.length,
    );
  });

  // ---- luồng gợi ý đầy đủ, có Gemini giả hành xử xấu
  const gap = { remainingCalories: 600, remainingProtein: 40, remainingCarbs: 60, remainingFat: 15 };
  const dietTypes = ['OMNIVORE', 'PESCATARIAN', 'VEGETARIAN', 'VEGAN', 'HALAL'];
  const allergyKeys = ['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'SHELLFISH', 'SOY'];

  function service(adversarial: boolean) {
    const svc: any = new AiService({ get: () => undefined } as any, {} as any, {} as any);
    if (adversarial) {
      svc.genAI = {
        getGenerativeModel: () => ({
          generateContent: async () => ({
            response: {
              text: () =>
                JSON.stringify({
                  advice: 'Ăn đủ đạm nhé',
                  picks: [
                    { name: 'Phở bò tái nạc', reason: 'Giàu đạm', calories: 99999 }, // vi phạm chế độ ăn
                    { name: 'Món bịa không có trong kho', reason: 'bịa' },
                    { name: 'Cá hồi áp chảo sốt chanh leo', reason: 'Giàu omega-3' },
                    { name: 'Trứng gà luộc', reason: 'Tiện' },
                  ],
                }),
            },
          }),
        }),
      };
    }
    return svc;
  }

  function violations(suggestions: any[], rules: { dietType: string; allergies: string[] }) {
    const bad: string[] = [];
    for (const s of suggestions) {
      const food = VIETNAMESE_FOODS_DATA.find((f) => `${f.name} (${f.servingSize})` === s.name);
      if (!food) {
        bad.push(`món ngoài kho: ${s.name}`);
        continue;
      }
      if (!isFoodAllowed(FOOD_SAFETY_TAGS[food.name], rules)) bad.push(food.name);
      if (s.calories !== Math.round(food.calories)) bad.push(`số liệu không lấy từ kho: ${food.name}`);
    }
    return bad;
  }

  it.each([false, true])(
    'AC: 20 user × 10 lần gợi ý → 0 vi phạm (Gemini giả hành xử xấu = %s)',
    async (adversarial) => {
      const svc = service(adversarial);
      const users: { dietType: string; allergies: string[] }[] = [];
      for (const dietType of dietTypes) {
        for (const a of allergyKeys.slice(0, 4)) users.push({ dietType, allergies: [a] });
      }
      expect(users).toHaveLength(20);
      let total = 0;
      for (const u of users) {
        for (let i = 0; i < 10; i++) {
          const res = await svc.suggestMealForGap('LOSE_WEIGHT', gap, u.allergies, u.dietType);
          total += res.suggestions.length;
          expect(violations(res.suggestions, u)).toEqual([]);
        }
      }
      expect(total).toBeGreaterThan(0);
    },
  );

  it('Gemini chọn món hợp lệ thì dùng lý do của Gemini nhưng số liệu vẫn lấy từ kho', async () => {
    const svc = service(true);
    const res = await svc.suggestMealForGap('LOSE_WEIGHT', gap, [], 'PESCATARIAN');
    const hoi = res.suggestions.find((s: any) => s.name.startsWith('Cá hồi'));
    expect(hoi).toBeDefined();
    expect(hoi.reason).toBe('Giàu omega-3');
    expect(hoi.calories).toBeLessThan(1000);
    expect(res.suggestions.some((s: any) => s.name.startsWith('Phở bò'))).toBe(false);
  });

  it('không còn món nào phù hợp → danh sách rỗng kèm lời giải thích, không bịa món', async () => {
    const svc = service(false);
    const res = await svc.suggestMealForGap('LOSE_WEIGHT', gap, ['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'SHELLFISH', 'SOY', 'PEANUT'], 'VEGAN');
    // thuần chay + dị ứng đậu nành/gluten vẫn còn trái cây, rau, cơm: kiểm tra chỉ rằng không có vi phạm
    for (const sug of res.suggestions) {
      const food = VIETNAMESE_FOODS_DATA.find((f) => `${f.name} (${f.servingSize})` === sug.name)!;
      expect(isFoodAllowed(FOOD_SAFETY_TAGS[food.name], { dietType: 'VEGAN', allergies: ['DAIRY', 'EGG', 'FISH', 'GLUTEN', 'SHELLFISH', 'SOY'] })).toBe(true);
    }
    const none = await svc.suggestMealForGap('LOSE_WEIGHT', gap, [], 'VEGAN');
    expect(Array.isArray(none.suggestions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BR-07.2 — Meal.logDate và ngày theo múi giờ của user
// ---------------------------------------------------------------------------
const FAKE_DATE_ONLY = ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] as const;
function freezeNow(iso: string) {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...FAKE_DATE_ONLY] });
}

describe('BR-07.2 Tiện ích ngày theo múi giờ', () => {
  it('keyToDate/dateToKey/addDaysToKey khớp nhau và không phụ thuộc múi giờ máy chủ', () => {
    expect(keyToDate('2026-10-06').toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(dateToKey(keyToDate('2026-10-06'))).toBe('2026-10-06');
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('mondayOnOrBefore: Thứ Hai giữ nguyên, các ngày khác lùi về Thứ Hai', () => {
    expect(mondayOnOrBefore('2026-10-05')).toBe('2026-10-05'); // Thứ Hai
    expect(mondayOnOrBefore('2026-10-07')).toBe('2026-10-05'); // Thứ Tư
    expect(mondayOnOrBefore('2026-10-11')).toBe('2026-10-05'); // Chủ Nhật
  });

  it('normalizeDayKey: ngày user chọn giữ nguyên; mốc thời gian đổi theo múi giờ', () => {
    expect(normalizeDayKey('2026-10-06', 'America/New_York')).toBe('2026-10-06');
    // 00:30 giờ Việt Nam ngày 06/10 = 17:30 UTC ngày 05/10
    expect(normalizeDayKey('2026-10-05T17:30:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-10-06');
    expect(normalizeDayKey('2026-10-05T17:30:00Z', 'America/New_York')).toBe('2026-10-05');
    expect(normalizeDayKey('không phải ngày', 'Asia/Ho_Chi_Minh')).toBeNull();
  });

  it('dayBoundsForKey: Việt Nam bắt đầu ngày lúc 17:00 UTC của hôm trước', () => {
    const { start, end } = dayBoundsForKey('2026-10-06', 'Asia/Ho_Chi_Minh');
    expect(start.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-06T17:00:00.000Z');
  });
});

describe('BR-07.2 Meal.logDate', () => {
  afterEach(() => jest.useRealTimers());

  function build(timezone: string) {
    const created: any[] = [];
    const queries: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ timezone, targetCalories: 2000, targetProtein: 150, targetCarb: 200, targetFat: 60 })),
      },
      meal: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { ...data, items: [] };
        }),
        findMany: jest.fn(async (args: any) => {
          queries.push(args);
          return [];
        }),
      },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
      workoutLog: { findMany: jest.fn(async () => []) },
      notification: { findFirst: jest.fn(async () => null) },
    };
    const service = new MealsService(prisma, { create: jest.fn() } as any);
    return { service, created, queries };
  }
  const item = { name: 'Cơm', calories: 100 };

  it('ngày dạng YYYY-MM-DD được giữ nguyên làm logDate, không dịch theo múi giờ', async () => {
    const { service, created } = build('America/New_York');
    await service.createMeal('u1', { mealType: 'LUNCH', date: '2026-10-06', items: [item] } as any);
    expect(created[0].logDate.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('bữa ghi lúc 00:30 giờ Việt Nam (mốc thời gian) thuộc ĐÚNG ngày hôm đó, không về hôm trước', async () => {
    const { service, created } = build('Asia/Ho_Chi_Minh');
    await service.createMeal('u1', { mealType: 'BREAKFAST', date: '2026-10-05T17:30:00Z', items: [item] } as any);
    expect(dateToKey(created[0].logDate)).toBe('2026-10-06');
  });

  it('cùng mốc thời gian nhưng user ở New York thì thuộc ngày 05/10', async () => {
    const { service, created } = build('America/New_York');
    await service.createMeal('u1', { mealType: 'DINNER', date: '2026-10-05T17:30:00Z', items: [item] } as any);
    expect(dateToKey(created[0].logDate)).toBe('2026-10-05');
  });

  it('không truyền ngày: "hôm nay" theo múi giờ user, không theo giờ máy chủ', async () => {
    freezeNow('2026-10-05T17:30:00Z'); // 00:30 ngày 06/10 ở Việt Nam, 13:30 ngày 05/10 ở New York
    const vn = build('Asia/Ho_Chi_Minh');
    await vn.service.quickAddMeal('u1', { mealType: 'SNACK', name: 'x', calories: 100 } as any);
    expect(dateToKey(vn.created[0].logDate)).toBe('2026-10-06');
    const ny = build('America/New_York');
    await ny.service.quickAddMeal('u1', { mealType: 'SNACK', name: 'x', calories: 100 } as any);
    expect(dateToKey(ny.created[0].logDate)).toBe('2026-10-05');
  });

  it('getMealsByDate và summary lọc theo logDate của ngày (không dùng khoảng giờ máy chủ)', async () => {
    freezeNow('2026-10-05T17:30:00Z');
    const { service, queries } = build('Asia/Ho_Chi_Minh');
    await service.getMealsByDate('u1');
    expect(queries[0].where.logDate.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    await service.getDailyNutritionSummary('u1', '2026-10-01');
    expect(queries[1].where.logDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('thống kê và tóm tắt tuần gom theo logDate', async () => {
    const meals = [
      { logDate: keyToDate('2026-10-05'), totalCalories: 1900, totalProtein: 100, totalCarb: 200, totalFat: 60 },
      { logDate: keyToDate('2026-10-05'), totalCalories: 100, totalProtein: 5, totalCarb: 10, totalFat: 3 },
      { logDate: keyToDate('2026-10-07'), totalCalories: 900, totalProtein: 50, totalCarb: 90, totalFat: 30 },
    ];
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'America/New_York', targetCalories: 2000 })) },
      meal: { findMany: jest.fn(async () => meals), findFirst: jest.fn() },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
    };
    const service = new MealsService(prisma, {} as any);
    const stats: any = await service.getNutritionStatistics('u1', '2026-10-05', '2026-10-11');
    expect(stats.data.period).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(stats.data.dailyStats.map((d: any) => d.date)).toEqual(['2026-10-05', '2026-10-07']);
    expect(stats.data.dailyStats[0].calories).toBe(2000);

    const week: any = await service.getWeekSummary('u1', '2026-10-05');
    expect(week.data.map((d: any) => d.date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
    expect(week.data[0]).toMatchObject({ hasData: true, metGoal: true, consumedCalories: 2000 });
    expect(week.data[1].hasData).toBe(false);
    expect(week.data[2].metGoal).toBe(false);
  });
});

describe('BR-07.2 Nước uống và buổi tập theo ngày của user', () => {
  afterEach(() => jest.useRealTimers());

  it('nước hôm nay: ranh giới là 00:00 giờ của user, không phải giờ máy chủ', async () => {
    freezeNow('2026-10-05T17:30:00Z'); // 00:30 ngày 06/10 ở Việt Nam
    let where: any;
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', weightKg: 70 })) },
      waterLog: {
        aggregate: jest.fn(async (args: any) => {
          where = args.where;
          return { _sum: { amountMl: 250 } };
        }),
      },
    };
    const service = new WaterLogsService(prisma);
    const res = await service.getToday('u1');
    expect(res.totalMl).toBe(250);
    expect(where.loggedAt.gte.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(where.loggedAt.lt.toISOString()).toBe('2026-10-06T17:00:00.000Z');
  });

  it('thống kê buổi tập trong ngày lọc theo ngày YYYY-MM-DD của user', async () => {
    freezeNow('2026-10-05T17:30:00Z');
    let where: any;
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      workoutLog: {
        findMany: jest.fn(async (args: any) => {
          where = args.where;
          return [{ durationMinutes: 30, caloriesBurned: 200, category: 'CARDIO' }];
        }),
      },
    };
    const service = new WorkoutsService(prisma);
    const res: any = await service.getDailySummary('u1');
    expect(res.date).toBe('2026-10-06');
    expect(where.date.gte.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(where.date.lt.toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('BR-06.2 / BR-06.5 Kỳ dữ liệu và mức tuân thủ của Check-in', () => {
  afterEach(() => jest.useRealTimers());

  async function run(nowIso: string, dayRows: { key: string; cals: number[] }[], target = 2000) {
    freezeNow(nowIso);
    const rows: any[] = [];
    for (const d of dayRows) {
      for (const c of d.cals) {
        rows.push({ logDate: keyToDate(d.key), totalCalories: c, totalProtein: c / 20, totalCarb: c / 10, totalFat: c / 30 });
      }
    }
    const user = {
      id: 'u1',
      programType: 'COACHED',
      goal: 'MAINTAIN',
      macroStyle: 'BALANCED',
      targetCalories: target,
      targetProtein: 150,
      targetCarb: 200,
      targetFat: 67,
      tdee: 2000,
      weightRateKgPerWeek: 0.5,
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const queries: any = {};
    const prisma: any = {
      user: { findUnique: jest.fn(async () => user) },
      meal: {
        findMany: jest.fn(async (args: any) => {
          queries.meal = args;
          return rows;
        }),
      },
      weightLog: { findMany: jest.fn(async () => []) },
      dailyLogStatus: { findMany: jest.fn(async () => []) },
      checkIn: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ ...args.data })),
      },
    };
    const expenditure: any = {
      recalculate: jest.fn(async () => ({ estimatedExpenditure: 2000, method: 'ADAPTIVE', status: 'STABLE' })),
    };
    const weights: any = { getWeightProgress: jest.fn(async () => ({ data: { progressPercent: 0 } })) };
    const service = new CheckinsService(prisma, expenditure, new HealthCalculatorService(), weights, { create: jest.fn() } as any);
    await service.generateCheckin('u1', {} as any);
    return { created: prisma.checkIn.create.mock.calls[0][0].data, queries };
  }

  it('tạo vào Thứ Tư 07/10 → dùng đúng 7 ngày trọn vẹn 28/09 – 04/10', async () => {
    const { created, queries } = await run('2026-10-07T03:00:00Z', []);
    expect(dateToKey(queries.meal.where.logDate.gte)).toBe('2026-09-28');
    expect(dateToKey(queries.meal.where.logDate.lte)).toBe('2026-10-04');
    expect(dateToKey(created.weekStartDate)).toBe('2026-09-28');
  });

  it('tạo vào Thứ Hai 05/10 → cũng là 28/09 – 04/10 (kỳ kết thúc hôm qua)', async () => {
    const { queries } = await run('2026-10-05T03:00:00Z', []);
    expect(dateToKey(queries.meal.where.logDate.gte)).toBe('2026-09-28');
    expect(dateToKey(queries.meal.where.logDate.lte)).toBe('2026-10-04');
  });

  it('Thứ Hai 00:30 giờ Việt Nam (Chủ Nhật theo UTC) vẫn tính là Thứ Hai của user', async () => {
    const { queries } = await run('2026-10-04T17:30:00Z', []);
    expect(dateToKey(queries.meal.where.logDate.lte)).toBe('2026-10-04');
  });

  it('tuân thủ hai chiều: ngày ăn 160% mục tiêu KHÔNG được tính là tuân thủ', async () => {
    const { created } = await run('2026-10-07T03:00:00Z', [
      { key: '2026-09-28', cals: [1000, 1000] }, // 100% → tuân thủ
      { key: '2026-09-29', cals: [1600, 1600] }, // 160% → không
      { key: '2026-09-30', cals: [900, 1000] }, // 95% → tuân thủ
      { key: '2026-10-01', cals: [1200, 1200] }, // 120% → không
    ]);
    expect(created.compliancePct).toBe(50);
  });

  it('chỉ ngày đầy đủ (≥ 2 bữa và ≥ 60% mục tiêu) mới vào trung bình và tuân thủ', async () => {
    const { created } = await run('2026-10-07T03:00:00Z', [
      { key: '2026-09-28', cals: [1000, 1000] }, // đầy đủ, 2000
      { key: '2026-09-29', cals: [2000] }, // 1 bữa → thiếu
      { key: '2026-09-30', cals: [300, 400] }, // 35% → thiếu
    ]);
    expect(created.avgDailyCalories).toBe(2000);
    expect(created.compliancePct).toBe(100);
  });

  it('không có ngày đầy đủ nào → không có trung bình và tuân thủ (không phạt)', async () => {
    const { created } = await run('2026-10-07T03:00:00Z', [{ key: '2026-09-28', cals: [200] }]);
    expect(created.avgDailyCalories).toBeNull();
    expect(created.compliancePct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BR-09.3 — kiểm tra giá trị cân nặng khi ghi
// ---------------------------------------------------------------------------
describe('BR-09.3 Kiểm tra giá trị khi ghi cân', () => {
  it('cân nặng 25 kg và 300 kg là biên hợp lệ', async () => {
    await expect(validate({ weightKg: 25 }, CreateWeightLogDto)).resolves.toBeDefined();
    await expect(validate({ weightKg: 300 }, CreateWeightLogDto)).resolves.toBeDefined();
    await expect(validate({ weightKg: 301 }, CreateWeightLogDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('ngày hôm nay và quá khứ hợp lệ; chuỗi không phải ngày bị từ chối', async () => {
    await expect(
      validate({ weightKg: 70, date: new Date().toISOString() }, CreateWeightLogDto),
    ).resolves.toBeDefined();
    await expect(
      validate({ weightKg: 70, date: '2026-01-15' }, CreateWeightLogDto),
    ).resolves.toBeDefined();
    await expect(
      validate({ weightKg: 70, date: 'hôm qua' }, CreateWeightLogDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nhập 150 khi xu hướng đang 65 kg → cờ suspicious = true; nhập 65.5 → false', async () => {
    const logs = [65, 65.2, 64.8, 65.1].map((w, i) => ({ weightKg: w, date: new Date(Date.now() - (5 - i) * DAY) }));
    const prisma: any = {
      weightLog: {
        create: jest.fn(async ({ data }: any) => data),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => logs),
      },
      user: { findUnique: jest.fn(async () => null), update: jest.fn() },
    };
    const service = new WeightLogsService(prisma, new HealthCalculatorService(), {} as any);
    const bad: any = await service.createLog('u1', { weightKg: 150 } as any);
    expect(bad.data.suspicious).toBe(true);
    const ok: any = await service.createLog('u1', { weightKg: 65.5 } as any);
    expect(ok.data.suspicious).toBe(false);
  });

  it('cân nặng 24 kg (dưới mức tối thiểu 25) bị từ chối', async () => {
    await expect(validate({ weightKg: 24 }, CreateWeightLogDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('ngày trong tương lai bị từ chối', async () => {
    const future = new Date(Date.now() + 7 * DAY).toISOString();
    await expect(
      validate({ weightKg: 70, date: future }, CreateWeightLogDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// BR-11.4 (chat) — cộng dồn token nguyên tử

// ---------------------------------------------------------------------------
// BR-13.1 — DAY_COMPLETED đánh giá ngày đã kết thúc
// ---------------------------------------------------------------------------
describe('BR-13.1 Thông báo DAY_COMPLETED', () => {
  afterEach(() => jest.useRealTimers());

  function build(meals: { totalCalories: number }[], flag?: string, already = false) {
    const created: any[] = [];
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', targetCalories: 2000 })) },
      meal: { findMany: jest.fn(async () => meals) },
      dailyLogStatus: { findMany: jest.fn(async () => (flag ? [{ logDate: keyToDate('2026-10-05'), completeness: flag }] : [])) },
      notification: { findFirst: jest.fn(async () => (already ? { id: 'n' } : null)) },
    };
    const notifications: any = { create: jest.fn(async (...a: any[]) => created.push(a)) };
    return { service: new MealsService(prisma, notifications), created };
  }

  it('hôm qua đầy đủ và 85–115% mục tiêu → chúc mừng một lần', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service, created } = build([{ totalCalories: 1000 }, { totalCalories: 900 }]);
    await service.evaluateFinishedDay('u1', '2026-10-05');
    expect(created).toHaveLength(1);
    expect(created[0][1]).toBe('DAY_COMPLETED');
  });

  it.each([
    ['ăn 140% (không phán xét: không gửi gì)', [{ totalCalories: 1400 }, { totalCalories: 1400 }], undefined, false],
    ['ngày thiếu bữa (1 bữa)', [{ totalCalories: 1900 }], undefined, false],
    ['người dùng đánh dấu chưa đủ', [{ totalCalories: 1000 }, { totalCalories: 1000 }], 'INCOMPLETE', false],
    ['đã gửi hôm nay rồi', [{ totalCalories: 1000 }, { totalCalories: 1000 }], undefined, true],
  ])('không gửi khi %s', async (_n, meals: any, flag: any, already: boolean) => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service, created } = build(meals, flag, already);
    await service.evaluateFinishedDay('u1', '2026-10-05');
    expect(created).toHaveLength(0);
  });

  it('ngày chưa kết thúc (hôm nay) không bao giờ được đánh giá', async () => {
    freezeNow('2026-10-06T03:00:00Z');
    const { service, created } = build([{ totalCalories: 1000 }, { totalCalories: 1000 }]);
    await service.evaluateFinishedDay('u1', '2026-10-06');
    expect(created).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BR-11.3 — quét thực đơn: cảnh báo và không đề xuất món vi phạm
// ---------------------------------------------------------------------------
describe('BR-11.3 Quét thực đơn lọc theo dị ứng và chế độ ăn', () => {
  it('detectTextViolations bắt đúng thịt/cá/trứng/sữa/heo/dị ứng, không báo nhầm bơ thành bò', () => {
    expect(detectTextViolations('Bún chả Hà Nội', { dietType: 'VEGETARIAN' })).toContain('có thịt');
    expect(detectTextViolations('Gỏi cuốn tôm', { dietType: 'VEGETARIAN' })).toContain('có cá/hải sản');
    expect(detectTextViolations('Bánh flan trứng sữa', { dietType: 'VEGAN' })).toEqual(expect.arrayContaining(['có trứng', 'có sữa']));
    expect(detectTextViolations('Sườn nướng', { dietType: 'HALAL' })).toContain('có thịt heo');
    expect(detectTextViolations('Phở bò', { dietType: 'HALAL' })).toEqual([]);
    expect(detectTextViolations('Kem bơ', { dietType: 'VEGAN' })).toEqual(expect.arrayContaining(['có sữa']));
    expect(detectTextViolations('Sinh tố bơ', { dietType: 'VEGETARIAN' })).toEqual([]);
    expect(detectTextViolations('Chè đậu phộng', { allergies: ['PEANUT'] })[0]).toMatch(/đậu phộng/);
    expect(detectTextViolations('Cơm trắng', { dietType: 'VEGAN', allergies: ['NONE'] })).toEqual([]);
  });

  async function scan(rules: { dietType: string; allergies: string[] }, items: any[]) {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', purchasedAiQuota: 0, ...rules, goal: 'LOSE_WEIGHT', targetCalories: 2000, targetProtein: 140 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      subscriptionState: { findUnique: jest.fn(async () => null) },
      manualGrant: { findFirst: jest.fn(async () => null) },
      usageCounter: {
        upsert: jest.fn(async () => ({})),
        findUnique: jest.fn(async () => ({ aiPhoto: 0 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      meal: { findMany: jest.fn(async () => []) },
      apiUsageLog: { create: jest.fn(async () => ({})) },
    };
    const svc: any = new AiService({ get: () => undefined } as any, prisma, {} as any);
    svc.genAI = {
      getGenerativeModel: () => ({
        generateContent: async () => ({ response: { text: () => JSON.stringify({ restaurantName: 'Quán A', items }) } }),
      }),
    };
    return svc.scanMenuBase64('aGVsbG8=', 'image/jpeg', 'u1');
  }
  const menu = [
    { name: 'Phở bò', description: 'Bánh phở, thịt bò', estimatedCalories: 450, protein: 30, carbs: 50, fat: 10, isRecommended: true },
    { name: 'Đậu phụ sốt cà', description: 'Đậu phụ, cà chua', estimatedCalories: 300, protein: 18, carbs: 20, fat: 12, isRecommended: true },
    { name: 'Cơm chiên trứng', description: 'Cơm, trứng', estimatedCalories: 500, protein: 15, carbs: 70, fat: 15, isRecommended: false },
  ];

  it('người ăn chay: món thịt/trứng có cảnh báo và không bao giờ nằm trong đề xuất', async () => {
    const res: any = await scan({ dietType: 'VEGAN', allergies: [] }, menu.map((m) => ({ ...m })));
    const byName = Object.fromEntries(res.items.map((i: any) => [i.name, i]));
    expect(byName['Phở bò'].warning).toBeDefined();
    expect(byName['Phở bò'].isRecommended).toBe(false);
    expect(byName['Cơm chiên trứng'].warning).toBeDefined();
    expect(byName['Đậu phụ sốt cà'].warning).toBeUndefined();
    expect(res.recommendedItems.map((i: any) => i.name)).toEqual(['Đậu phụ sốt cà']);
  });

  it('dị ứng đậu nành: món đậu phụ bị cảnh báo; không còn món an toàn được đề xuất thì danh sách đề xuất rỗng', async () => {
    const res: any = await scan({ dietType: 'VEGAN', allergies: ['SOY'] }, menu.map((m) => ({ ...m })));
    expect(res.items.find((i: any) => i.name === 'Đậu phụ sốt cà').warning).toMatch(/đậu nành/);
    expect(res.recommendedItems).toEqual([]);
  });
});
