-- BR-10.7: nhớ lần xử lý đề xuất đối chiếu số buổi tập để không hỏi lại ngay. Chạy lại an toàn.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activityCheckAt" TIMESTAMP(3);
