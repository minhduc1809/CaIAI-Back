ALTER TABLE "CustomFood" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE INDEX IF NOT EXISTS "CustomFood_userId_barcode_idx" ON "CustomFood"("userId", "barcode");
