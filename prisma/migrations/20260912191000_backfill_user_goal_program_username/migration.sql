-- CreateEnum
CREATE TYPE "MacroStyle" AS ENUM ('BALANCED', 'HIGH_CARB_LOW_FAT', 'LOW_CARB_HIGH_FAT', 'KETO');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bodyFatPercent" DOUBLE PRECISION,
ADD COLUMN     "macroStyle" "MacroStyle" DEFAULT 'BALANCED',
ADD COLUMN     "targetWeightKg" DOUBLE PRECISION,
ADD COLUMN     "username" TEXT NOT NULL,
ADD COLUMN     "weightRateKgPerWeek" DOUBLE PRECISION DEFAULT 0.5,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

