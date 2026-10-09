-- BR-09.4: thứ tự nhập thật của các lần cân
ALTER TABLE "WeightLog" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
