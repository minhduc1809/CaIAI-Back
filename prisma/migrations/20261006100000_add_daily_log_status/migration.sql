-- CreateEnum
CREATE TYPE "DayCompleteness" AS ENUM ('AUTO', 'COMPLETE', 'INCOMPLETE');

-- CreateTable
CREATE TABLE "DailyLogStatus" (
    "userId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "completeness" "DayCompleteness" NOT NULL DEFAULT 'AUTO',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLogStatus_pkey" PRIMARY KEY ("userId","logDate")
);

-- AddForeignKey
ALTER TABLE "DailyLogStatus" ADD CONSTRAINT "DailyLogStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
