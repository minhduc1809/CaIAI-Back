-- I6: ManualGrant có nguồn rõ ràng thay vì nhét "AUTO:BANK" vào adminId.
ALTER TABLE "ManualGrant" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "ManualGrant" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "ManualGrant" ADD COLUMN IF NOT EXISTS "orderCode" TEXT;

-- Quyền sinh ra từ đơn QR: reason có dạng QR_ORDER:<mã đơn>
UPDATE "ManualGrant"
SET "source" = 'QR_ORDER',
    "orderCode" = substring("reason" from 10),
    "adminId" = CASE WHEN "adminId" = 'AUTO:BANK' THEN NULL ELSE "adminId" END
WHERE "reason" LIKE 'QR_ORDER:%' AND "source" = 'ADMIN';

-- Thông báo khi đơn QR được duyệt
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_SUCCESS';
