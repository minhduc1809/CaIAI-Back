-- Ngày Check-in hằng tuần do người dùng chọn (BR-06.1) và số liệu giải thích Check-in thiếu dữ liệu (BR-06.3).
-- Mọi lệnh đều "nếu chưa có" nên chạy lại an toàn; không đụng dữ liệu hiện có.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "checkinDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CheckIn"
  ADD COLUMN IF NOT EXISTS "completeDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "dataNeeds" JSONB;
