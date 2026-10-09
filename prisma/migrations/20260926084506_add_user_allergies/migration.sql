-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[];
