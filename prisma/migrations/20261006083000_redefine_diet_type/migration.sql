-- BR-02.1: tách "chế độ ăn" (lọc món) khỏi "tỷ lệ macro". Đổi enum DietType và ánh xạ dữ liệu cũ:
-- BALANCED, KETO, LOW_CARB, OTHER -> OMNIVORE; giữ VEGETARIAN, VEGAN, PESCATARIAN.
ALTER TYPE "DietType" RENAME TO "DietType_old";

CREATE TYPE "DietType" AS ENUM ('OMNIVORE', 'PESCATARIAN', 'VEGETARIAN', 'VEGAN', 'HALAL');

ALTER TABLE "User" ALTER COLUMN "dietType" DROP DEFAULT;

ALTER TABLE "User" ALTER COLUMN "dietType" TYPE "DietType" USING (
  CASE
    WHEN "dietType" IS NULL THEN NULL
    WHEN "dietType"::text = 'VEGETARIAN' THEN 'VEGETARIAN'
    WHEN "dietType"::text = 'VEGAN' THEN 'VEGAN'
    WHEN "dietType"::text = 'PESCATARIAN' THEN 'PESCATARIAN'
    ELSE 'OMNIVORE'
  END
)::"DietType";

ALTER TABLE "User" ALTER COLUMN "dietType" SET DEFAULT 'OMNIVORE';

DROP TYPE "DietType_old";
