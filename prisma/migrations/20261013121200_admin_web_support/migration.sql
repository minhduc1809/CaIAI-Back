ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "adminNote" TEXT;
ALTER TABLE "FoodCatalog" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
-- Các món nạp sẵn từ kho gốc ghi rõ "chờ chuyên gia rà soát" thì đánh dấu cần rà soát
UPDATE "FoodCatalog" SET "needsReview" = true
WHERE "needsReview" = false AND "dataSource" ILIKE '%chờ chuyên gia rà soát%';
