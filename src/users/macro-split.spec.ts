import { Gender, GoalType, MacroStyle, ProteinPreference } from '@prisma/client';
import { UsersService } from './users.service';
import { HealthCalculatorService, FAT_FLOOR_NOTE } from './health-calculator.service';

const calc = new HealthCalculatorService();
const STYLES = [MacroStyle.BALANCED, MacroStyle.HIGH_CARB_LOW_FAT, MacroStyle.LOW_CARB_HIGH_FAT, MacroStyle.KETO];
const GOALS = [GoalType.LOSE_WEIGHT, GoalType.MAINTAIN, GoalType.GAIN_WEIGHT];

const base = {
  weightKg: 70,
  heightCm: 175,
  gender: Gender.MALE,
  goal: GoalType.MAINTAIN,
  proteinPreference: ProteinPreference.MID,
};
const kcalOf = (m: { protein: number | null; carb: number | null; fat: number | null }) =>
  (m.protein ?? 0) * 4 + (m.carb ?? 0) * 4 + (m.fat ?? 0) * 9;
/** Sàn béo theo đặc tả cộng sàn tuyệt đối theo giới. */
const fatFloor = (weight: number, calories: number, gender: Gender) =>
  Math.max(
    Math.round(weight * 0.6),
    Math.round((calories * 0.2) / 9),
    gender === Gender.FEMALE ? 40 : 45,
  );

describe('C2 / BR-03.5: chia béo và tinh bột theo phong cách', () => {
  // 70 kg nam giữ cân: đạm 1,6 g/kg = 112 g (448 kcal), R = 1552 kcal, sàn béo = 45 g
  it('BALANCED chia R theo 55:45 (tinh bột:béo)', () => {
    const m = calc.calculateMacros(2000, MacroStyle.BALANCED, base);
    expect(m).toEqual({ protein: 112, carb: 213, fat: 78, fatFloorApplied: false });
  });

  it('HIGH_CARB_LOW_FAT: 75:25 cho béo 43 g nên bị sàn béo 45 g nâng lên', () => {
    const m = calc.calculateMacros(2000, MacroStyle.HIGH_CARB_LOW_FAT, base);
    expect(m).toEqual({ protein: 112, carb: 287, fat: 45, fatFloorApplied: true });
  });

  it('LOW_CARB_HIGH_FAT chia R theo 30:70', () => {
    const m = calc.calculateMacros(2000, MacroStyle.LOW_CARB_HIGH_FAT, base);
    expect(m).toEqual({ protein: 112, carb: 116, fat: 121, fatFloorApplied: false });
  });

  it('KETO: tinh bột = min(50 g, 5% calo) = 25 g, béo là phần còn lại', () => {
    const m = calc.calculateMacros(2000, MacroStyle.KETO, base);
    expect(m.fat).toBe(161);
    expect(m.carb).toBeLessThanOrEqual(26); // 25 g + dồn sai số làm tròn
    expect(m.carb).toBeGreaterThanOrEqual(25);
    expect(m.fatFloorApplied).toBe(false);
  });

  it('KETO ở calo cao: tinh bột bị chặn ở 50 g', () => {
    const m = calc.calculateMacros(4000, MacroStyle.KETO, { ...base, weightKg: 90, goal: GoalType.GAIN_WEIGHT });
    expect(m.carb).toBeLessThanOrEqual(51);
  });

  // Bảng 3 goal × 4 phong cách × nhiều cân nặng/calo: các bất biến luôn đúng
  const cases: { w: number; h: number; g: Gender; cal: number }[] = [
    { w: 45, h: 155, g: Gender.FEMALE, cal: 1200 }, // rất nhẹ, calo thấp nhất
    { w: 60, h: 165, g: Gender.FEMALE, cal: 1500 },
    { w: 70, h: 175, g: Gender.MALE, cal: 2000 },
    { w: 95, h: 180, g: Gender.MALE, cal: 2600 },
    { w: 130, h: 180, g: Gender.MALE, cal: 2200 }, // BMI 40
    { w: 150, h: 175, g: Gender.MALE, cal: 1500 }, // rất nặng, calo thấp: sàn béo theo cân gần tràn calo
  ];

  describe.each(cases)('cân %p kg, %p kcal', ({ w, h, g, cal }) => {
    for (const goal of GOALS) {
      for (const style of STYLES) {
        it(`${goal} · ${style}: tổng calo khớp ±1%, béo ≥ sàn, không có số âm`, () => {
          const m = calc.calculateMacros(cal, style, {
            weightKg: w,
            heightCm: h,
            gender: g,
            goal,
            proteinPreference: ProteinPreference.MID,
          });
          const total = kcalOf(m);
          expect(Math.abs(total - cal)).toBeLessThanOrEqual(Math.max(3, cal * 0.01));
          expect(m.protein!).toBeGreaterThan(0);
          expect(m.carb!).toBeGreaterThanOrEqual(0);
          expect(m.fat!).toBeGreaterThanOrEqual(0);

          // Đạm không vượt 35% calo
          expect((m.protein! * 4) / cal).toBeLessThanOrEqual(0.351);

          // Sàn béo luôn được tôn trọng, trừ khi calo quá thấp so với cân nặng (khi đó giữ sàn theo % calo
          // và sàn tuyệt đối để tinh bột không âm)
          const pctOnly = Math.max(Math.round((cal * 0.2) / 9), g === Gender.FEMALE ? 40 : 45);
          expect(m.fat!).toBeGreaterThanOrEqual(pctOnly);
          if (fatFloor(w, cal, g) * 9 + m.protein! * 4 + 120 <= cal) {
            expect(m.fat!).toBeGreaterThanOrEqual(fatFloor(w, cal, g));
          }
        });
      }
    }
  });

  it('người rất nặng calo thấp: béo theo cân bị giới hạn để còn chỗ cho tinh bột (không âm)', () => {
    const m = calc.calculateMacros(1500, MacroStyle.BALANCED, { ...base, weightKg: 150, heightCm: 175 });
    expect(m.carb!).toBeGreaterThanOrEqual(0);
    expect(m.fatFloorApplied).toBe(true);
  });

  it('cờ fatFloorApplied chỉ bật khi béo bị nâng lên sàn', () => {
    expect(calc.calculateMacros(2000, MacroStyle.BALANCED, base).fatFloorApplied).toBe(false);
    expect(calc.calculateMacros(2000, MacroStyle.HIGH_CARB_LOW_FAT, base).fatFloorApplied).toBe(true);
  });

  it('chưa có mục tiêu calo: không trả số nào', () => {
    expect(calc.calculateMacros(null, MacroStyle.BALANCED, base)).toEqual({
      protein: null,
      carb: null,
      fat: null,
      fatFloorApplied: false,
    });
  });

  it('đạm vẫn theo g/kg (C1) trước khi chia béo/tinh bột: có % mỡ dùng LBM/0,85', () => {
    // 100 kg, 30% mỡ → LBM 70 → 82,35 kg × 1,6 = 131,8 → 132 g
    const m = calc.calculateMacros(2500, MacroStyle.BALANCED, { ...base, weightKg: 100, bodyFatPercent: 30 });
    expect(m.protein).toBe(132);
  });

  it('calculateAllMetrics trả cờ fatFloorApplied cùng macro', () => {
    const r = calc.calculateAllMetrics({
      weightKg: 70,
      heightCm: 175,
      dateOfBirth: new Date('1995-01-01'),
      gender: Gender.MALE,
      goal: GoalType.MAINTAIN,
      activityLevel: 'MODERATELY_ACTIVE' as any,
      macroStyle: MacroStyle.HIGH_CARB_LOW_FAT,
    });
    expect(typeof r.fatFloorApplied).toBe('boolean');
    expect(r.targetFat).toBeGreaterThanOrEqual(45);
  });
});

describe('BR-03.7: xem trước tỉ lệ thực tế từng phong cách', () => {
  it('trả 4 phong cách, % cộng đúng 100 và khớp số gram', () => {
    const list = calc.previewMacroStyles(2000, base);
    expect(list.map((p) => p.style)).toEqual(STYLES);
    for (const p of list) {
      expect(p.proteinPct + p.carbPct + p.fatPct).toBe(100);
      expect(Math.abs(p.fatPct - Math.round(((p.fat * 9) / 2000) * 100))).toBe(0);
      expect(kcalOf(p) - 2000).toBeLessThanOrEqual(3);
    }
  });

  it('"ít béo" bị sàn béo nâng lên thì có cờ và ghi chú, kèm tỉ lệ thật (không phải 15%)', () => {
    const low = calc.previewMacroStyles(2000, base).find((p) => p.style === MacroStyle.HIGH_CARB_LOW_FAT)!;
    expect(low.fatFloorApplied).toBe(true);
    expect(low.note).toBe(FAT_FLOOR_NOTE);
    expect(low.fat).toBe(45);
    expect(low.fatPct).toBe(20);
    const balanced = calc.previewMacroStyles(2000, base).find((p) => p.style === MacroStyle.BALANCED)!;
    expect(balanced.note).toBeNull();
  });

  it('phong cách ít béo vẫn ít béo hơn cân bằng, nhiều béo thì nhiều hơn (thứ tự hợp lý)', () => {
    const byStyle = Object.fromEntries(calc.previewMacroStyles(2000, base).map((p) => [p.style, p]));
    expect(byStyle.HIGH_CARB_LOW_FAT.fat).toBeLessThan(byStyle.BALANCED.fat);
    expect(byStyle.BALANCED.fat).toBeLessThan(byStyle.LOW_CARB_HIGH_FAT.fat);
    expect(byStyle.LOW_CARB_HIGH_FAT.fat).toBeLessThan(byStyle.KETO.fat);
    expect(byStyle.HIGH_CARB_LOW_FAT.carb).toBeGreaterThan(byStyle.BALANCED.carb);
    expect(byStyle.KETO.carb).toBeLessThan(byStyle.LOW_CARB_HIGH_FAT.carb);
  });

  it('chưa có calo: danh sách rỗng', () => {
    expect(calc.previewMacroStyles(null, base)).toEqual([]);
  });
});

describe('GET /users/me/macro-preview', () => {
  const userRow = {
    id: 'u1',
    heightCm: 175,
    weightKg: 70,
    targetWeightKg: null,
    weightRateKgPerWeek: null,
    weightRatePercent: null,
    bodyFatPercent: null,
    dateOfBirth: new Date('1995-01-01'),
    gender: Gender.MALE,
    pregnancyStatus: 'NONE',
    activityLevel: 'MODERATELY_ACTIVE',
    goal: GoalType.MAINTAIN,
    macroStyle: MacroStyle.BALANCED,
    proteinPreference: ProteinPreference.MID,
    targetCalories: 2000,
  };
  const make = (row: any) => {
    const prisma: any = { user: { findUnique: jest.fn(async () => row) } };
    return new UsersService(prisma, calc, {} as any);
  };

  it('dùng mục tiêu calo đang áp dụng và trả 4 phong cách cùng phong cách hiện tại', async () => {
    const res = await make(userRow).getMacroPreview('u1');
    expect(res.targetCalories).toBe(2000);
    expect(res.currentStyle).toBe(MacroStyle.BALANCED);
    expect(res.styles).toHaveLength(4);
  });

  it('chưa có mục tiêu: tính tạm từ hồ sơ, không ghi gì vào DB', async () => {
    const res = await make({ ...userRow, targetCalories: null }).getMacroPreview('u1');
    expect(res.targetCalories).toBeGreaterThan(1000);
    expect(res.styles).toHaveLength(4);
  });

  it('hồ sơ chưa đủ để tính: lỗi PROFILE_INCOMPLETE', async () => {
    const svc = make({ ...userRow, targetCalories: null, heightCm: null, weightKg: null });
    await expect(svc.getMacroPreview('u1')).rejects.toMatchObject({
      response: { code: 'PROFILE_INCOMPLETE' },
    });
  });

  it('không tìm thấy người dùng: 404', async () => {
    await expect(make(null).getMacroPreview('nope')).rejects.toMatchObject({ status: 404 });
  });
});
