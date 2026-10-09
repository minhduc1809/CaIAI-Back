import { dateToKey, keyToDate } from './date-zone.util';

/**
 * Quy tắc "ngày đầy đủ" (BR-05.2). Chỉ ngày đầy đủ mới được dùng để tính lượng ăn trung bình,
 * Expenditure và mức tuân thủ.
 *
 * - Người dùng đánh dấu INCOMPLETE ("Hôm nay ghi chưa đủ"): luôn bị loại.
 * - Người dùng đánh dấu COMPLETE ("Đã ghi đủ hôm nay"): được dùng nếu ngày đó có ít nhất một bữa.
 * - AUTO hoặc chưa đánh dấu: tự động đầy đủ khi có ≥ 2 bữa VÀ tổng calo ≥ 60% mục tiêu.
 * - Ngày không có bữa nào luôn bị bỏ qua (nguyên tắc "không phạt").
 *
 * Đây là mặc định; BR-19 sẽ chuyển sang SystemConfig (engine.autoCompleteMinMeals / MinPctTarget).
 */
export const DAY_COMPLETENESS = {
  autoMinMeals: 2,
  autoMinPctTarget: 60,
} as const;

export type DayCompletenessFlag = 'AUTO' | 'COMPLETE' | 'INCOMPLETE';

export function isCompleteDay(
  mealCount: number,
  calories: number,
  targetCalories: number,
  flag: DayCompletenessFlag | null | undefined = null,
): boolean {
  if (mealCount < 1) return false;
  if (flag === 'INCOMPLETE') return false;
  if (flag === 'COMPLETE') return true;
  return (
    mealCount >= DAY_COMPLETENESS.autoMinMeals &&
    calories >= (targetCalories * DAY_COMPLETENESS.autoMinPctTarget) / 100
  );
}

/** Đọc các cờ ngày đầy đủ do người dùng đánh dấu trong khoảng [startKey, endKey] → Map(khoá ngày → cờ). */
export async function loadDayFlags(
  prisma: {
    dailyLogStatus: {
      findMany: (args: any) => Promise<
        { logDate: Date; completeness: DayCompletenessFlag }[]
      >;
    };
  },
  userId: string,
  startKey: string,
  endKey: string,
): Promise<Map<string, DayCompletenessFlag>> {
  const rows = await prisma.dailyLogStatus.findMany({
    where: {
      userId,
      logDate: { gte: keyToDate(startKey), lte: keyToDate(endKey) },
    },
  });
  return new Map(rows.map((r) => [dateToKey(r.logDate), r.completeness]));
}
