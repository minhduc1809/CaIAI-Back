-- Bổ sung các thay đổi schema đã có trong schema.prisma nhưng chưa có migration:
--   · RefreshSession  (phiên đăng nhập nhiều thiết bị, BR-01.3)
--   · AdminAuditLog   (nhật ký quản trị, BR-17)
--   · Meal.clientRequestId (chống ghi trùng khi gửi lại, BR-07.5)
--   · MealItem.sourceType / sourceId (nguồn gốc món, BR-07.3)
--   · WeightLog.isOutlier / confirmedAt (cân ngoại lai, BR-05.3)
--   · ExpenditureSnapshot.snapshotDate (một snapshot mỗi ngày, BR-05.7)
--
-- Mọi lệnh đều "nếu chưa có" nên chạy an toàn dù một phần đã tồn tại, và không xoá dữ liệu người dùng
-- (chỉ gộp các snapshot Expenditure trùng ngày, giữ bản mới nhất, để tạo được ràng buộc duy nhất).

-- ---------------------------------------------------------------- cột mới
ALTER TABLE "Meal" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

ALTER TABLE "MealItem"
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT;

ALTER TABLE "WeightLog"
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isOutlier" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ExpenditureSnapshot" ADD COLUMN IF NOT EXISTS "snapshotDate" DATE;

-- ---------------------------------------------------------------- bảng mới
CREATE TABLE IF NOT EXISTS "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------- dữ liệu cũ của Expenditure
-- Snapshot cũ chưa có snapshotDate: điền theo ngày (múi giờ Việt Nam) của recordedAt.
UPDATE "ExpenditureSnapshot"
SET "snapshotDate" = (("recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
WHERE "snapshotDate" IS NULL;

-- Trước đây ghi nhiều snapshot mỗi ngày; giờ mỗi (người dùng, ngày) chỉ một dòng. Giữ dòng mới nhất.
DELETE FROM "ExpenditureSnapshot" a
USING "ExpenditureSnapshot" b
WHERE a."userId" = b."userId"
  AND a."snapshotDate" = b."snapshotDate"
  AND (a."recordedAt" < b."recordedAt" OR (a."recordedAt" = b."recordedAt" AND a."id" < b."id"));

-- ---------------------------------------------------------------- chỉ mục
CREATE INDEX IF NOT EXISTS "RefreshSession_userId_revokedAt_idx" ON "RefreshSession"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE UNIQUE INDEX IF NOT EXISTS "Meal_userId_clientRequestId_key" ON "Meal"("userId", "clientRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenditureSnapshot_userId_snapshotDate_key" ON "ExpenditureSnapshot"("userId", "snapshotDate");

-- ---------------------------------------------------------------- khoá ngoại
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RefreshSession_userId_fkey') THEN
    ALTER TABLE "RefreshSession"
      ADD CONSTRAINT "RefreshSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
