-- CreateTable
CREATE TABLE "WeeklySummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "avgCalories" DOUBLE PRECISION,
    "avgProtein" DOUBLE PRECISION,
    "avgFat" DOUBLE PRECISION,
    "avgCarb" DOUBLE PRECISION,
    "weightChangeKg" DOUBLE PRECISION,
    "workoutsCompleted" INTEGER NOT NULL DEFAULT 0,
    "highlightText" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklySummary_userId_createdAt_idx" ON "WeeklySummary"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySummary_userId_weekStartDate_key" ON "WeeklySummary"("userId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "WeeklySummary" ADD CONSTRAINT "WeeklySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
