/**
 * Ngữ cảnh sức khoẻ "đầy đủ hơn" của AI Coach cho Premium (FP 2.11). Gói Free chỉ có ngữ cảnh cơ bản (mục tiêu, cân
 * nặng, bữa hôm nay); Premium thêm xu hướng cân nặng, mức năng lượng thích ứng, Check-in gần nhất và tập luyện tuần.
 * Hàm thuần để kiểm thử; không có dữ liệu thì bỏ qua dòng đó, không bịa số.
 */
export interface PremiumContextInput {
  /** Các lần cân gần nhất, mới trước cũ sau. */
  weights: { weightKg: number; date: Date }[];
  adaptiveExpenditure?: number | null;
  lastCheckin?: {
    weekEndDate: Date;
    status: string;
    compliancePct?: number | null;
    avgDailyCalories?: number | null;
    currentCalorieTarget: number;
    proposedCalorieTarget: number;
  } | null;
  /** Buổi tập 7 ngày gần nhất. */
  workouts: { name: string; durationMinutes: number; caloriesBurned?: number | null }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Chênh lệch kg giữa lần cân mới nhất và cũ nhất trong khoảng, kèm số ngày. */
export function weightTrend(weights: { weightKg: number; date: Date }[]): { deltaKg: number; days: number } | null {
  if (weights.length < 2) return null;
  const newest = weights[0];
  const oldest = weights[weights.length - 1];
  const days = Math.max(1, Math.round((newest.date.getTime() - oldest.date.getTime()) / 86_400_000));
  return { deltaKg: r1(newest.weightKg - oldest.weightKg), days };
}

export function buildPremiumContext(input: PremiumContextInput): string {
  const lines: string[] = [];

  const trend = weightTrend(input.weights);
  if (trend) {
    const sign = trend.deltaKg > 0 ? '+' : '';
    lines.push(`- Xu hướng cân nặng: ${sign}${trend.deltaKg} kg trong ${trend.days} ngày gần đây (${input.weights.length} lần cân)`);
  } else if (input.weights.length === 1) {
    lines.push(`- Lần cân gần nhất: ${r1(input.weights[0].weightKg)} kg (chưa đủ dữ liệu để nói về xu hướng)`);
  }

  if (input.adaptiveExpenditure && input.adaptiveExpenditure > 0) {
    lines.push(`- Mức năng lượng tiêu hao ước tính theo dữ liệu thực tế: khoảng ${Math.round(input.adaptiveExpenditure)} kcal/ngày`);
  }

  const c = input.lastCheckin;
  if (c) {
    const parts = [`Check-in gần nhất (kết thúc ${c.weekEndDate.toISOString().slice(0, 10)}, trạng thái ${c.status})`];
    if (c.compliancePct != null) parts.push(`tuân thủ ${Math.round(c.compliancePct)}% số ngày`);
    if (c.avgDailyCalories != null) parts.push(`trung bình ${Math.round(c.avgDailyCalories)} kcal/ngày`);
    if (c.proposedCalorieTarget !== c.currentCalorieTarget) {
      parts.push(`đề xuất mục tiêu ${c.currentCalorieTarget} → ${c.proposedCalorieTarget} kcal`);
    }
    lines.push(`- ${parts.join(', ')}`);
  }

  if (input.workouts.length > 0) {
    const minutes = input.workouts.reduce((a, w) => a + (w.durationMinutes || 0), 0);
    const names = input.workouts.slice(0, 4).map((w) => w.name).join(', ');
    lines.push(`- Tập luyện 7 ngày qua: ${input.workouts.length} buổi, tổng ${minutes} phút (${names})`);
  } else {
    lines.push('- Tập luyện 7 ngày qua: chưa ghi nhận buổi nào');
  }

  if (lines.length === 0) return '';
  return `\n--- SỨC KHOẺ CHI TIẾT (dữ liệu thật của người dùng, chỉ dùng khi liên quan, đừng liệt kê lại cả danh sách) ---\n${lines.join('\n')}\n`;
}
