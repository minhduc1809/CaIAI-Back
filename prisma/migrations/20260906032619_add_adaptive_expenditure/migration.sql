-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adaptiveExpenditure" DOUBLE PRECISION,
ADD COLUMN     "expenditureStatus" TEXT NOT NULL DEFAULT 'UPDATING',
ADD COLUMN     "expenditureUpdatedAt" TIMESTAMP(3);
