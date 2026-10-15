-- Khoá bài tập thống nhất để gom lịch sử và tính kỷ lục. Bản ghi cũ để trống, ứng dụng điền dần khi cần. Chạy lại an toàn.
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "exerciseKey" TEXT;
CREATE INDEX IF NOT EXISTS "WorkoutExercise_exerciseKey_idx" ON "WorkoutExercise"("exerciseKey");
