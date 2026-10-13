-- BR-15.5: ApiUsageLog ghi số liệu AI thật (model, độ trễ, kết quả). Chạy lại an toàn; bản ghi cũ giữ nguyên.
ALTER TABLE "ApiUsageLog"
  ADD COLUMN IF NOT EXISTS "model" TEXT,
  ADD COLUMN IF NOT EXISTS "latencyMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'OK';
