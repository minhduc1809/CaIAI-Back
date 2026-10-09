-- CreateEnum
CREATE TYPE "TargetLimit" AS ENUM ('FLOOR', 'DEFICIT_CAP', 'SURPLUS_CAP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "targetLimitedBy" "TargetLimit";
