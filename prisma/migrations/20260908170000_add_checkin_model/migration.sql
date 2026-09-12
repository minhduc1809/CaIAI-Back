-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "Mood" AS ENUM ('GREAT', 'GOOD', 'OKAY', 'BAD', 'TERRIBLE');

-- CreateEnum
CREATE TYPE "CheckInAdjustmentReason" AS ENUM ('EXPENDITURE_CHANGE', 'GOAL_CHANGE', 'SMOOTHING', 'NO_CHANGE');

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'PENDING',
    "avgDailyCalories" DOUBLE PRECISION,
    "avgDailyProtein" DOUBLE PRECISION,
    "avgDailyCarb" DOUBLE PRECISION,
    "avgDailyFat" DOUBLE PRECISION,
    "weightAtCheckin" DOUBLE PRECISION,
    "compliancePct" DOUBLE PRECISION,
    "currentCalorieTarget" INTEGER NOT NULL,
    "proposedCalorieTarget" INTEGER NOT NULL,
    "currentProteinTarget" DOUBLE PRECISION,
    "proposedProteinTarget" DOUBLE PRECISION,
    "currentCarbTarget" DOUBLE PRECISION,
    "proposedCarbTarget" DOUBLE PRECISION,
    "currentFatTarget" DOUBLE PRECISION,
    "proposedFatTarget" DOUBLE PRECISION,
    "newExpenditure" DOUBLE PRECISION,
    "adjustmentReason" "CheckInAdjustmentReason" NOT NULL DEFAULT 'EXPENDITURE_CHANGE',
    "goalProgressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mood" "Mood",
    "note" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_userId_weekStartDate_key" ON "CheckIn"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "CheckIn_userId_status_idx" ON "CheckIn"("userId", "status");

-- CreateIndex
CREATE INDEX "CheckIn_userId_createdAt_idx" ON "CheckIn"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
