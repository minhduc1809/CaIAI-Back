-- CreateEnum
CREATE TYPE "PregnancyStatus" AS ENUM ('NONE', 'PREGNANT', 'LACTATING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "pregnancyStatus" "PregnancyStatus" DEFAULT 'NONE',
ADD COLUMN "weightRatePercent" DOUBLE PRECISION,
ADD COLUMN "onboardingDraft" JSONB;
