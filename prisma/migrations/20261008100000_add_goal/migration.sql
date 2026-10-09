-- BR-09.5: mục tiêu cân nặng hiện hành, mốc bắt đầu của tiến độ
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalType" "GoalType" NOT NULL,
    "startWeight" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetWeight" DOUBLE PRECISION,
    "rateKgPerWeek" DOUBLE PRECISION,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Người dùng hiện có: mỗi người một Goal ACTIVE, mốc bắt đầu giữ như cách tính cũ (bản ghi cân sớm nhất, nếu chưa có thì cân hiện tại)
INSERT INTO "Goal" ("id", "userId", "goalType", "startWeight", "startDate", "targetWeight", "rateKgPerWeek", "status")
SELECT
    gen_random_uuid()::text,
    u."id",
    u."goal",
    COALESCE((SELECT w."weightKg" FROM "WeightLog" w WHERE w."userId" = u."id" ORDER BY w."date" ASC, w."createdAt" ASC LIMIT 1), u."weightKg"),
    COALESCE((SELECT w."date" FROM "WeightLog" w WHERE w."userId" = u."id" ORDER BY w."date" ASC, w."createdAt" ASC LIMIT 1), CURRENT_TIMESTAMP),
    u."targetWeightKg",
    u."weightRateKgPerWeek",
    'ACTIVE'
FROM "User" u
WHERE u."goal" IS NOT NULL AND u."weightKg" IS NOT NULL;
