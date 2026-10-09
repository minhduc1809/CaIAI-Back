-- BR-07.2: Meal.logDate = ngày của bữa ăn theo múi giờ của user, tính một lần lúc tạo.
ALTER TABLE "Meal" ADD COLUMN "logDate" DATE;

-- Backfill: app gửi ngày dạng YYYY-MM-DD nên phần lớn dữ liệu cũ nằm đúng 00:00 UTC => lấy thẳng ngày đó.
-- Bản ghi có giờ cụ thể thì đổi sang ngày theo múi giờ của user.
UPDATE "Meal" m
SET "logDate" = CASE
  WHEN m."date"::time = TIME '00:00:00' THEN m."date"::date
  ELSE ((m."date" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(u."timezone", 'Asia/Ho_Chi_Minh'))::date
END
FROM "User" u
WHERE u."id" = m."userId";

UPDATE "Meal" SET "logDate" = "date"::date WHERE "logDate" IS NULL;

ALTER TABLE "Meal" ALTER COLUMN "logDate" SET NOT NULL;

CREATE INDEX "Meal_userId_logDate_idx" ON "Meal"("userId", "logDate");
