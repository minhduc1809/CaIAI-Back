-- CreateEnum
CREATE TYPE "ServingUnit" AS ENUM ('GRAM', 'ML', 'PORTION');

-- AlterTable
ALTER TABLE "MealItem" ADD COLUMN     "servingAmount" DOUBLE PRECISION,
ADD COLUMN     "servingUnit" "ServingUnit" DEFAULT 'PORTION';

-- AlterTable
ALTER TABLE "CustomFood" ADD COLUMN     "servingAmount" DOUBLE PRECISION,
ADD COLUMN     "servingUnit" "ServingUnit" DEFAULT 'PORTION';
