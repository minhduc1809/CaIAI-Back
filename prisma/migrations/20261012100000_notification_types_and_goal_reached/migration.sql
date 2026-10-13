-- BR-13.1: bộ loại thông báo mới và cờ "đã báo chạm cân đích" của Goal.
--
-- Bỏ GOAL_EXCEEDED, GOAL_ACHIEVED, AI_MESSAGE, MEAL_REMINDER, WATER_REMINDER; thêm WEEKLY_SUMMARY_READY,
-- FOOD_SUBMISSION_RESULT, GOAL_REACHED. Postgres không cho xoá giá trị enum, nên tạo enum mới rồi đổi cột.
-- Thông báo thuộc các loại đã bỏ bị xoá (chúng ngắn hạn, đã có quy tắc xoá sau 30 ngày); các loại còn lại giữ nguyên.
-- Chạy lại an toàn: khối chỉ thực hiện khi enum còn giá trị cũ.

ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "reachedNotifiedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'MEAL_REMINDER'
  ) THEN
    DELETE FROM "Notification"
    WHERE "type"::text IN ('MEAL_REMINDER', 'WATER_REMINDER', 'GOAL_ACHIEVED', 'GOAL_EXCEEDED', 'AI_MESSAGE');

    CREATE TYPE "NotificationType_new" AS ENUM (
      'CHECKIN_READY', 'DAY_COMPLETED', 'BILLING_ISSUE',
      'WEEKLY_SUMMARY_READY', 'FOOD_SUBMISSION_RESULT', 'GOAL_REACHED'
    );

    ALTER TABLE "Notification"
      ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");

    ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
    ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
    DROP TYPE "NotificationType_old";
  END IF;
END
$$;
