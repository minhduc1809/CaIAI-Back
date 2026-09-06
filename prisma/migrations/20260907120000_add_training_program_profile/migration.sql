-- CreateEnum
CREATE TYPE "TrainingGoal" AS ENUM ('BUILD_MUSCLE', 'LOSE_FAT', 'STRENGTH', 'ENDURANCE', 'RECOMP', 'GENERAL_FITNESS');

-- CreateEnum
CREATE TYPE "SessionsPerWeek" AS ENUM ('ONE_TO_TWO', 'THREE_TO_FOUR', 'FIVE_TO_SIX', 'SEVEN');

-- CreateEnum
CREATE TYPE "EquipmentAccess" AS ENUM ('FULL_GYM', 'BASIC_GYM', 'HOME_DUMBBELL', 'BODYWEIGHT_ONLY');

-- CreateEnum
CREATE TYPE "ProgramType" AS ENUM ('COACHED', 'COLLABORATIVE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProteinPreference" AS ENUM ('LOW', 'MID', 'HIGH', 'VERY_HIGH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trainingExperience" "WorkoutLevel" DEFAULT 'BEGINNER',
ADD COLUMN     "trainingGoal" "TrainingGoal" DEFAULT 'GENERAL_FITNESS',
ADD COLUMN     "sessionsPerWeek" "SessionsPerWeek" DEFAULT 'THREE_TO_FOUR',
ADD COLUMN     "equipmentAccess" "EquipmentAccess" DEFAULT 'BODYWEIGHT_ONLY',
ADD COLUMN     "injuries" TEXT[] DEFAULT '{}',
ADD COLUMN     "injuriesOtherNote" TEXT,
ADD COLUMN     "oneRepMaxSquatKg" DOUBLE PRECISION,
ADD COLUMN     "oneRepMaxBenchKg" DOUBLE PRECISION,
ADD COLUMN     "oneRepMaxDeadliftKg" DOUBLE PRECISION,
ADD COLUMN     "programType" "ProgramType" DEFAULT 'COACHED',
ADD COLUMN     "proteinPreference" "ProteinPreference" DEFAULT 'MID',
ADD COLUMN     "isIntermittentFasting" BOOLEAN DEFAULT false,
ADD COLUMN     "ifWindowStart" TEXT,
ADD COLUMN     "ifWindowEnd" TEXT;
