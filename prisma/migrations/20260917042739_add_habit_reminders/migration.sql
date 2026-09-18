-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'WATER', 'CUSTOM');

-- CreateTable
CREATE TABLE "HabitReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL DEFAULT 'CUSTOM',
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeOfDay" TEXT NOT NULL,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "targetCalorieMin" DOUBLE PRECISION,
    "targetCalorieMax" DOUBLE PRECISION,
    "waterIntervalMinutes" INTEGER,
    "repeatDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "advanceNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HabitReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitReminderFood" (
    "id" TEXT NOT NULL,
    "habitReminderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "servingSize" TEXT,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitReminderFood_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HabitReminder_userId_sortOrder_idx" ON "HabitReminder"("userId", "sortOrder");

-- AddForeignKey
ALTER TABLE "HabitReminder" ADD CONSTRAINT "HabitReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitReminderFood" ADD CONSTRAINT "HabitReminderFood_habitReminderId_fkey" FOREIGN KEY ("habitReminderId") REFERENCES "HabitReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
