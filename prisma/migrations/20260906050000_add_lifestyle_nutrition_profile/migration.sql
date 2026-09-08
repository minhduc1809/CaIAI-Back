-- CreateEnum
CREATE TYPE "StressLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DietType" AS ENUM ('BALANCED', 'VEGETARIAN', 'VEGAN', 'KETO', 'LOW_CARB', 'PESCATARIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "FoodBudgetLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sleepHours" DOUBLE PRECISION,
ADD COLUMN     "stressLevel" "StressLevel" DEFAULT 'MEDIUM',
ADD COLUMN     "takesSupplements" BOOLEAN DEFAULT false,
ADD COLUMN     "dietType" "DietType" DEFAULT 'BALANCED',
ADD COLUMN     "mealsPerDay" INTEGER DEFAULT 3,
ADD COLUMN     "cookTimeMinutes" INTEGER DEFAULT 30,
ADD COLUMN     "foodBudgetLevel" "FoodBudgetLevel" DEFAULT 'MEDIUM';
