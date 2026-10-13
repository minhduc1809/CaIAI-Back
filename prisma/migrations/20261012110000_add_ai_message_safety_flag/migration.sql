-- BR-11.6: đánh dấu tin nhắn AI Chat đã kích hoạt chế độ an toàn. Chạy lại an toàn.
ALTER TABLE "AiMessage" ADD COLUMN IF NOT EXISTS "safetyFlag" TEXT;
