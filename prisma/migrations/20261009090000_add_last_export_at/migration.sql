-- BR-18: giới hạn xuất dữ liệu 1 lần/ngày
ALTER TABLE "User" ADD COLUMN "lastExportAt" TIMESTAMP(3);
