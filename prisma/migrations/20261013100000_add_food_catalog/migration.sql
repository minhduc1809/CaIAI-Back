-- BR-08.1: kho món ăn trong cơ sở dữ liệu. Chạy lại an toàn.
CREATE TABLE IF NOT EXISTS "FoodCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "aliases" TEXT[],
    "category" TEXT NOT NULL,
    "servingSize" TEXT NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "allergens" TEXT[],
    "containsMeat" BOOLEAN NOT NULL DEFAULT false,
    "containsFish" BOOLEAN NOT NULL DEFAULT false,
    "containsEgg" BOOLEAN NOT NULL DEFAULT false,
    "containsDairy" BOOLEAN NOT NULL DEFAULT false,
    "containsPork" BOOLEAN NOT NULL DEFAULT false,
    "safetyTagged" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'OFFICIAL',
    "dataSource" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FoodCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FoodCatalog_name_key" ON "FoodCatalog"("name");
CREATE INDEX IF NOT EXISTS "FoodCatalog_category_isActive_idx" ON "FoodCatalog"("category", "isActive");
CREATE INDEX IF NOT EXISTS "FoodCatalog_nameNormalized_idx" ON "FoodCatalog"("nameNormalized");

-- Chỉ mục trigram cho tìm kiếm không dấu khi kho lớn. Cần quyền tạo extension; nếu không có thì bỏ qua
-- (ứng dụng tìm trong bộ nhớ nên vẫn chạy đúng, chỉ mất lợi thế chỉ mục khi kho rất lớn).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "FoodCatalog_nameNormalized_trgm_idx"
    ON "FoodCatalog" USING gin ("nameNormalized" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Bỏ qua chỉ mục pg_trgm: %', SQLERRM;
END
$$;
