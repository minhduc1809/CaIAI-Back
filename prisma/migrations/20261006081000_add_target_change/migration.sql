-- CreateEnum
CREATE TYPE "TargetChangeSource" AS ENUM ('ONBOARDING', 'GOAL_CHANGE', 'CHECKIN_ACCEPTED', 'MANUAL', 'PROFILE_RECALC');

-- CreateTable
CREATE TABLE "TargetChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "TargetChangeSource" NOT NULL,
    "oldCalories" DOUBLE PRECISION,
    "newCalories" DOUBLE PRECISION,
    "oldMacros" JSONB,
    "newMacros" JSONB,
    "checkinId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetChange_userId_createdAt_idx" ON "TargetChange"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TargetChange" ADD CONSTRAINT "TargetChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
