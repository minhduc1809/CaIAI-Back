import { PrismaClient } from '@prisma/client';

/** Cột đếm theo ngày trong UsageCounter. */
export type CounterColumn = 'aiPhoto' | 'menuScans' | 'suggestMeals' | 'barcodeLookups' | 'chatMessages';

type Db = Pick<PrismaClient, 'usageCounter'>;

async function ensureRow(db: Db, userId: string, date: string) {
  try {
    await db.usageCounter.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date },
      update: {},
    });
  } catch (e) {
    // Request khác vừa tạo dòng này cùng lúc: dòng đã tồn tại
    if ((e as { code?: string })?.code !== 'P2002') throw e;
  }
}

/**
 * Giữ chỗ MỘT lượt bằng một câu UPDATE có điều kiện (`cột < giới hạn`): hai request đồng thời khi chỉ còn
 * một lượt thì đúng một request giữ được. Trả về true nếu giữ được.
 */
export async function reserveDaily(
  db: Db,
  userId: string,
  date: string,
  column: CounterColumn,
  limit: number,
): Promise<boolean> {
  await ensureRow(db, userId, date);
  const res = await db.usageCounter.updateMany({
    where: { userId, date, [column]: { lt: limit } },
    data: { [column]: { increment: 1 } },
  });
  return res.count === 1;
}

/** Hoàn lại một lượt đã giữ khi xử lý thất bại. Không bao giờ xuống dưới 0. */
export async function refundDaily(db: Db, userId: string, date: string, column: CounterColumn) {
  try {
    await db.usageCounter.updateMany({
      where: { userId, date, [column]: { gt: 0 } },
      data: { [column]: { decrement: 1 } },
    });
  } catch {
    // hoàn lượt là nỗ lực tốt nhất; không để lỗi này che lỗi gốc
  }
}

/** Số lượt đã dùng hôm nay của một cột. */
export async function usedToday(db: Db, userId: string, date: string, column: CounterColumn): Promise<number> {
  const row = await db.usageCounter.findUnique({ where: { userId_date: { userId, date } } });
  return (row as Record<string, number> | null)?.[column] ?? 0;
}
