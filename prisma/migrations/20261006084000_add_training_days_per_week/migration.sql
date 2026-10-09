-- BR-03.6: số buổi tập/tuần dạng số nguyên (0–7), cho phép "chưa tập" = 0.
ALTER TABLE "User" ADD COLUMN "trainingDaysPerWeek" INTEGER;

-- Backfill từ nhóm cũ theo trung điểm nhóm. Không đụng tới activityLevel đang lưu của user hiện có.
UPDATE "User" SET "trainingDaysPerWeek" = CASE "sessionsPerWeek"::text
  WHEN 'ONE_TO_TWO' THEN 2
  WHEN 'THREE_TO_FOUR' THEN 4
  WHEN 'FIVE_TO_SIX' THEN 5
  WHEN 'SEVEN' THEN 7
END
WHERE "sessionsPerWeek" IS NOT NULL;
