-- BR-06.6: vòng đời Check-in. DISMISSED (Để sau) đổi tên thành SNOOZED, thêm 3 trạng thái mới.
ALTER TYPE "CheckInStatus" RENAME VALUE 'DISMISSED' TO 'SNOOZED';
ALTER TYPE "CheckInStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "CheckInStatus" ADD VALUE 'INSUFFICIENT_DATA';
ALTER TYPE "CheckInStatus" ADD VALUE 'ACKNOWLEDGED';
