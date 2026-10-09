import { GoalType, PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'goal'>;

export interface StartGoalInput {
  goalType: GoalType;
  startWeight: number;
  targetWeight?: number | null;
  rateKgPerWeek?: number | null;
  startDate?: Date;
}

/** Goal đang hiệu lực của user (nếu có). */
export function getActiveGoal(db: Db, userId: string) {
  return db.goal.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { startDate: 'desc' },
  });
}

/**
 * Bắt đầu một Goal mới: đóng Goal ACTIVE cũ rồi tạo Goal mới (BR-09.5). Gọi khi hoàn tất Onboarding hoặc khi
 * user đổi loại mục tiêu / cân đích. Đổi tốc độ không tạo Goal mới vì không đổi đích đến.
 */
export async function startGoal(db: Db, userId: string, input: StartGoalInput) {
  const now = new Date();
  await db.goal.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: now },
  });
  return db.goal.create({
    data: {
      userId,
      goalType: input.goalType,
      startWeight: input.startWeight,
      startDate: input.startDate ?? now,
      targetWeight: input.targetWeight ?? null,
      rateKgPerWeek: input.rateKgPerWeek ?? null,
    },
  });
}
