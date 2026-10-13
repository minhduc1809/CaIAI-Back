ALTER TABLE "FavoriteFood" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "FavoriteFood" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
CREATE INDEX IF NOT EXISTS "FavoriteFood_userId_sourceType_sourceId_idx" ON "FavoriteFood"("userId", "sourceType", "sourceId");

-- Gắn định danh cho yêu thích cũ khi tên khớp đúng một món trong kho hoặc món tự tạo của chính người dùng
UPDATE "FavoriteFood" f
SET "sourceType" = 'CATALOG', "sourceId" = c."id"
FROM "FoodCatalog" c
WHERE f."sourceType" IS NULL AND c."name" = f."foodName";

UPDATE "FavoriteFood" f
SET "sourceType" = 'CUSTOM', "sourceId" = cf."id"
FROM "CustomFood" cf
WHERE f."sourceType" IS NULL AND cf."userId" = f."userId" AND cf."name" = f."foodName";
