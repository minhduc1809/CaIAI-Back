-- Chống ghi trùng bữa ăn khi bấm đúp hoặc thử lại
ALTER TABLE "Meal" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Meal_userId_dedupeKey_key" ON "Meal"("userId", "dedupeKey");
