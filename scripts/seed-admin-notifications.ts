/**
 * Backfill thông báo GOAL_ACHIEVED THẬT cho admin dựa trên dữ liệu Meal đã có sẵn trong DB
 * (từ seed-admin-week.ts) — tính lại đúng công thức maybeNotifyGoalAchieved() ở meals.service.ts,
 * không bịa số liệu. Chạy: npx ts-node scripts/seed-admin-notifications.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { username: 'admin' } });
  if (!admin) {
    console.error('Không tìm thấy user username="admin".');
    process.exit(1);
  }
  const target = admin.targetCalories || 2000;

  // Xoá notification GOAL_ACHIEVED cũ của admin để script chạy lại không bị trùng.
  await prisma.notification.deleteMany({ where: { userId: admin.id, type: 'GOAL_ACHIEVED' } });

  const meals = await prisma.meal.findMany({
    where: { userId: admin.id },
    select: { date: true, totalCalories: true },
  });

  const byDay = new Map<string, number>();
  for (const m of meals) {
    const key = toDateOnly(m.date).toISOString();
    byDay.set(key, (byDay.get(key) || 0) + m.totalCalories);
  }

  let created = 0;
  for (const [key, consumed] of byDay.entries()) {
    const metGoal = consumed >= target * 0.85 && consumed <= target * 1.15;
    if (!metGoal) continue;
    const day = new Date(key);
    await prisma.notification.create({
      data: {
        userId: admin.id,
        type: 'GOAL_ACHIEVED',
        title: 'Đạt mục tiêu calo hôm nay!',
        message: `Bạn đã nạp ${Math.round(consumed)} kcal, đạt mục tiêu ${Math.round(target)} kcal ngày ${day.toLocaleDateString('vi-VN')}.`,
        createdAt: day,
      },
    });
    created++;
    console.log(`  ${day.toISOString().slice(0, 10)}: consumed=${Math.round(consumed)} target=${Math.round(target)} -> notification`);
  }

  console.log(`Xong — tạo ${created} thông báo GOAL_ACHIEVED thật từ dữ liệu Meal có sẵn.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
