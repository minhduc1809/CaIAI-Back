-- Bộ đếm theo ngày cho các tính năng có giới hạn Free/Premium (quét thực đơn, gợi ý món, mã vạch)
ALTER TABLE "UsageCounter" ADD COLUMN "menuScans" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageCounter" ADD COLUMN "suggestMeals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageCounter" ADD COLUMN "barcodeLookups" INTEGER NOT NULL DEFAULT 0;
