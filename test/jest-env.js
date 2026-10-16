// Các test giả định chế độ giới hạn gói Free TẮT. Prisma tự nạp `.env` (có thể bật BILLING_ENFORCE để thử tay),
// nên đặt sẵn giá trị ở đây: biến đã tồn tại sẽ không bị `.env` ghi đè.
process.env.BILLING_ENFORCE = 'false';
