import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  Gender,
  GoalType,
  MacroStyle,
  PregnancyStatus,
  ProteinPreference,
  Prisma,
} from '@prisma/client';
import { UsersService } from './users.service';
import { HealthCalculatorService } from './health-calculator.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SaveOnboardingDraftDto } from './dto/onboarding-draft.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (value: any, metatype: any = UpdateProfileDto) =>
  pipe.transform(value, { type: 'body', metatype });

describe('BR-02.2 Kiểm soát độ tuổi (18–100 tuổi)', () => {
  it('độ tuổi 18 đến 100 hợp lệ qua ValidationPipe', async () => {
    // 25 tuổi
    await expect(
      validate({ dateOfBirth: '2000-01-01' }),
    ).resolves.toBeDefined();
    // Đủ 18 tuổi
    const d18 = new Date();
    d18.setFullYear(d18.getFullYear() - 19);
    await expect(
      validate({ dateOfBirth: d18.toISOString().split('T')[0] }),
    ).resolves.toBeDefined();
  });

  it('dưới 18 tuổi bị ValidationPipe từ chối', async () => {
    const d15 = new Date();
    d15.setFullYear(d15.getFullYear() - 15);
    await expect(
      validate({ dateOfBirth: d15.toISOString().split('T')[0] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trên 100 tuổi hoặc ngày tương lai bị ValidationPipe từ chối', async () => {
    await expect(
      validate({ dateOfBirth: '1900-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await expect(
      validate({ dateOfBirth: future.toISOString().split('T')[0] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BR-02.2 Phụ nữ mang thai và cho con bú', () => {
  function buildService(user: any) {
    const updates: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { ...user, ...data };
        }),
      },
      targetChange: { create: jest.fn() },
      goal: { updateMany: jest.fn(), create: jest.fn() },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({
        method: 'STATIC_FALLBACK',
        status: 'UPDATING',
        estimatedExpenditure: null,
      })),
    };
    const service = new UsersService(
      prisma,
      new HealthCalculatorService(),
      adaptive,
    );
    return { service, updates };
  }

  it('nam giới chọn PREGNANT hoặc LACTATING bị từ chối 400', async () => {
    const { service } = buildService({
      id: 'u1',
      gender: Gender.MALE,
      weightKg: 70,
      heightCm: 175,
      dateOfBirth: new Date('1995-01-01'),
      goal: GoalType.MAINTAIN,
      pregnancyStatus: PregnancyStatus.NONE,
    });

    await expect(
      service.updateProfile('u1', {
        pregnancyStatus: PregnancyStatus.PREGNANT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phụ nữ mang thai hoặc cho con bú bị cấm chọn giảm cân (LOSE_WEIGHT)', async () => {
    const { service } = buildService({
      id: 'u1',
      gender: Gender.FEMALE,
      weightKg: 60,
      heightCm: 160,
      dateOfBirth: new Date('1998-01-01'),
      goal: GoalType.MAINTAIN,
      pregnancyStatus: PregnancyStatus.NONE,
    });

    await expect(
      service.updateProfile('u1', {
        pregnancyStatus: PregnancyStatus.PREGNANT,
        goal: GoalType.LOSE_WEIGHT,
        targetWeightKg: 55,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phụ nữ mang thai được cộng thêm 300 kcal vào mức năng lượng nền', () => {
    const calc = new HealthCalculatorService();
    const base = {
      heightCm: 160,
      weightKg: 55,
      dateOfBirth: new Date('1998-01-01'),
      gender: Gender.FEMALE,
      activityLevel: 'LIGHTLY_ACTIVE' as any,
      goal: GoalType.MAINTAIN,
    };

    const normal = calc.calculateAllMetrics(base);
    const pregnant = calc.calculateAllMetrics({
      ...base,
      pregnancyStatus: PregnancyStatus.PREGNANT,
    });

    expect(pregnant.targetCalories!).toBe(normal.targetCalories! + 300);
  });

  it('phụ nữ cho con bú được cộng thêm 500 kcal vào mức năng lượng nền', () => {
    const calc = new HealthCalculatorService();
    const base = {
      heightCm: 160,
      weightKg: 55,
      dateOfBirth: new Date('1998-01-01'),
      gender: Gender.FEMALE,
      activityLevel: 'LIGHTLY_ACTIVE' as any,
      goal: GoalType.MAINTAIN,
    };

    const normal = calc.calculateAllMetrics(base);
    const lactating = calc.calculateAllMetrics({
      ...base,
      pregnancyStatus: PregnancyStatus.LACTATING,
    });

    expect(lactating.targetCalories!).toBe(normal.targetCalories! + 500);
  });
});

describe('BR-02.3 Tốc độ theo % cân nặng và cân đích bắt buộc', () => {
  function buildService(user: any) {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
      },
      targetChange: { create: jest.fn() },
      goal: { updateMany: jest.fn(), create: jest.fn() },
    };
    const adaptive: any = {
      recalculate: jest.fn(async () => ({
        method: 'STATIC_FALLBACK',
        status: 'UPDATING',
        estimatedExpenditure: null,
      })),
      recordSnapshot: jest.fn(),
    };
    const service = new UsersService(
      prisma,
      new HealthCalculatorService(),
      adaptive,
    );
    return { service, prisma };
  }

  it('giảm cân: bắt buộc có cân đích và targetWeightKg phải nhỏ hơn cân hiện tại', async () => {
    const { service } = buildService({
      id: 'u1',
      weightKg: 80,
      heightCm: 175,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.MAINTAIN,
    });

    // Không truyền cân đích khi đổi sang giảm cân
    await expect(
      service.updateProfile('u1', {
        goal: GoalType.LOSE_WEIGHT,
        targetWeightKg: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Cân đích lớn hơn hoặc bằng cân hiện tại khi giảm cân
    await expect(
      service.updateProfile('u1', {
        goal: GoalType.LOSE_WEIGHT,
        targetWeightKg: 85,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tăng cân: bắt buộc có cân đích và targetWeightKg phải lớn hơn cân hiện tại', async () => {
    const { service } = buildService({
      id: 'u1',
      weightKg: 50,
      heightCm: 170,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.MAINTAIN,
    });

    await expect(
      service.updateProfile('u1', {
        goal: GoalType.GAIN_WEIGHT,
        targetWeightKg: 48,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tốc độ theo % cân nặng: truyền weightRatePercent tự động tính weightRateKgPerWeek', async () => {
    const { service, prisma } = buildService({
      id: 'u1',
      weightKg: 80,
      heightCm: 175,
      targetWeightKg: 70,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.LOSE_WEIGHT,
      targetCalories: 2000,
    });

    // 0.5% của 80 kg = 0.4 kg/tuần
    await service.updateProfile('u1', { weightRatePercent: 0.5 });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          weightRateKgPerWeek: 0.4,
          weightRatePercent: 0.5,
        }),
      }),
    );
  });

  it('giảm cân vượt quá 1% cân nặng/tuần (ở người không béo phì) bị chặn an toàn', async () => {
    const { service } = buildService({
      id: 'u1',
      weightKg: 60,
      heightCm: 170, // BMI = 20.8 (bình thường)
      targetWeightKg: 55,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.FEMALE,
      goal: GoalType.LOSE_WEIGHT,
      targetCalories: 1800,
    });

    // 1.2 kg/tuần với 60 kg = 2.0% cân nặng/tuần -> vượt trần an toàn 1.0%
    await expect(
      service.updateProfile('u1', { weightRateKgPerWeek: 1.2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BR-02.4 Lưu nháp Onboarding', () => {
  it('GET, PUT, DELETE draft qua UsersService', async () => {
    let savedDraft: any = null;
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ onboardingDraft: savedDraft })),
        update: jest.fn(async ({ data }: any) => {
          if ('onboardingDraft' in data) {
            savedDraft =
              data.onboardingDraft === Prisma.DbNull
                ? null
                : data.onboardingDraft;
          }
          return { onboardingDraft: savedDraft };
        }),
      },
    };
    const service = new UsersService(
      prisma,
      new HealthCalculatorService(),
      {} as any,
    );

    // Chưa có draft
    const initial = await service.getOnboardingDraft('u1');
    expect(initial.data).toBeNull();

    // Lưu draft bước 3
    const draftPayload: SaveOnboardingDraftDto = {
      step: 3,
      data: { gender: 'MALE', heightCm: 175, weightKg: 70 },
    };
    await service.saveOnboardingDraft('u1', draftPayload);

    // Đọc lại draft
    const fetched = await service.getOnboardingDraft('u1');
    expect(fetched.data).toMatchObject({ step: 3, data: draftPayload.data });

    // Xóa draft
    await service.clearOnboardingDraft('u1');
    const afterClear = await service.getOnboardingDraft('u1');
    expect(afterClear.data).toBeNull();
  });
});

describe('BR-03.4 Đạm theo g/kg cân nặng (Protein per kg)', () => {
  const calc = new HealthCalculatorService();

  it('giảm cân (LOSE_WEIGHT): đạm tính theo g/kg (mặc định 2.0 g/kg cho MID, không theo % calo)', () => {
    // 70 kg, mục tiêu LOSE_WEIGHT -> 70 * 2.0 = 140g đạm
    const metrics = calc.calculateAllMetrics({
      weightKg: 70,
      heightCm: 175,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.LOSE_WEIGHT,
      activityLevel: 'MODERATELY_ACTIVE',
      macroStyle: MacroStyle.BALANCED,
      proteinPreference: ProteinPreference.MID,
    });

    expect(metrics.targetProtein).toBe(140);
  });

  it('thay đổi proteinPreference điều chỉnh lượng đạm g/kg', () => {
    const base = {
      weightKg: 80,
      heightCm: 180,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.LOSE_WEIGHT,
      activityLevel: 'MODERATELY_ACTIVE' as any,
      macroStyle: MacroStyle.BALANCED,
    };

    // LOW (1.6 g/kg) = 128g
    const low = calc.calculateAllMetrics({
      ...base,
      proteinPreference: ProteinPreference.LOW,
    });
    expect(low.targetProtein).toBe(128);

    // HIGH (2.2 g/kg) = 176g
    const high = calc.calculateAllMetrics({
      ...base,
      proteinPreference: ProteinPreference.HIGH,
    });
    expect(high.targetProtein).toBe(176);
  });
});

describe('BR-03.5 Sàn chất béo tối thiểu an toàn (Fat Floor)', () => {
  const calc = new HealthCalculatorService();

  it('HIGH_CARB_LOW_FAT không bao giờ hạ chất béo xuống dưới sàn an toàn nội tiết', () => {
    // 60 kg nữ, calo thấp 1400 kcal -> sàn béo tối thiểu = max(60*0.7=42g, 1400*0.2/9=31g, sàn nữ 40g) = 42g
    const metrics = calc.calculateAllMetrics({
      weightKg: 60,
      heightCm: 160,
      dateOfBirth: new Date('1998-01-01'),
      gender: Gender.FEMALE,
      goal: GoalType.LOSE_WEIGHT,
      activityLevel: 'LIGHTLY_ACTIVE',
      macroStyle: MacroStyle.HIGH_CARB_LOW_FAT,
    });

    expect(metrics.targetFat).toBeGreaterThanOrEqual(40);
  });
});

describe('BR-03.7 Tổng năng lượng đồng bộ (P*4 + C*4 + F*9 ≈ Target Calories)', () => {
  const calc = new HealthCalculatorService();

  it('mọi tổ hợp mục tiêu và macroStyle đều có tổng calo từ macro lệch không quá 3 kcal', () => {
    const weights = [50, 70, 95];
    const styles = [
      MacroStyle.BALANCED,
      MacroStyle.HIGH_CARB_LOW_FAT,
      MacroStyle.LOW_CARB_HIGH_FAT,
      MacroStyle.KETO,
    ];
    const goals = [
      GoalType.LOSE_WEIGHT,
      GoalType.MAINTAIN,
      GoalType.GAIN_WEIGHT,
    ];

    for (const w of weights) {
      for (const s of styles) {
        for (const g of goals) {
          const res = calc.calculateAllMetrics({
            weightKg: w,
            heightCm: 170,
            dateOfBirth: new Date('1996-01-01'),
            gender: Gender.MALE,
            goal: g,
            macroStyle: s,
            activityLevel: 'MODERATELY_ACTIVE',
          });

          if (
            res.targetCalories &&
            res.targetProtein &&
            res.targetCarb &&
            res.targetFat
          ) {
            const sumMacrosCals =
              res.targetProtein * 4 + res.targetCarb * 4 + res.targetFat * 9;
            expect(
              Math.abs(sumMacrosCals - res.targetCalories),
            ).toBeLessThanOrEqual(3);
          }
        }
      }
    }
  });
});
