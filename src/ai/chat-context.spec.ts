import { buildPremiumContext, weightTrend } from './chat-context';

const d = (iso: string) => new Date(iso);

describe('Ngữ cảnh AI Coach cho Premium (FP 2.11)', () => {
  it('xu hướng cân nặng: mới nhất trừ cũ nhất, kèm số ngày', () => {
    const t = weightTrend([
      { weightKg: 69.2, date: d('2026-10-13') },
      { weightKg: 70.0, date: d('2026-10-06') },
      { weightKg: 71.0, date: d('2026-09-29') },
    ]);
    expect(t).toEqual({ deltaKg: -1.8, days: 14 });
    expect(weightTrend([{ weightKg: 70, date: d('2026-10-13') }])).toBeNull();
  });

  it('có dữ liệu thì mô tả đủ các phần', () => {
    const text = buildPremiumContext({
      weights: [
        { weightKg: 69.2, date: d('2026-10-13') },
        { weightKg: 71.0, date: d('2026-09-29') },
      ],
      adaptiveExpenditure: 2350.4,
      lastCheckin: {
        weekEndDate: d('2026-10-11'), status: 'ACCEPTED', compliancePct: 71.4, avgDailyCalories: 1980,
        currentCalorieTarget: 2000, proposedCalorieTarget: 1900,
      },
      workouts: [
        { name: 'Ngực', durationMinutes: 50 },
        { name: 'Chạy bộ', durationMinutes: 30 },
      ],
    });
    expect(text).toContain('-1.8 kg trong 14 ngày');
    expect(text).toContain('khoảng 2350 kcal/ngày');
    expect(text).toContain('tuân thủ 71%');
    expect(text).toContain('2000 → 1900');
    expect(text).toContain('2 buổi, tổng 80 phút');
  });

  it('không bịa số khi thiếu dữ liệu', () => {
    const text = buildPremiumContext({ weights: [], workouts: [] });
    expect(text).toContain('chưa ghi nhận buổi nào');
    expect(text).not.toContain('Xu hướng cân nặng');
    expect(text).not.toContain('tiêu hao');
    expect(text).not.toContain('Check-in');
  });

  it('một lần cân thì nói chưa đủ để có xu hướng; mục tiêu không đổi thì không nêu đề xuất', () => {
    const text = buildPremiumContext({
      weights: [{ weightKg: 70, date: d('2026-10-13') }],
      lastCheckin: { weekEndDate: d('2026-10-11'), status: 'ACCEPTED', currentCalorieTarget: 2000, proposedCalorieTarget: 2000 },
      workouts: [],
    });
    expect(text).toContain('chưa đủ dữ liệu để nói về xu hướng');
    expect(text).not.toContain('đề xuất mục tiêu');
  });
});
