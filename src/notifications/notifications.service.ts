import { isNotificationDisabled } from '../users/user-settings';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

/** Thông báo cũ hơn số ngày này bị xoá (BR-13.1, `notification.retentionDays`). */
export const NOTIFICATION_RETENTION_DAYS = 30;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, now: Date = new Date()) {
    // Dọn lười khi người dùng mở danh sách: không cần job nền, và lỗi dọn không làm hỏng việc xem thông báo
    try {
      await this.prisma.notification.deleteMany({
        where: {
          userId,
          createdAt: {
            lt: new Date(
              now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000,
            ),
          },
        },
      });
    } catch {
      // bỏ qua: lần mở sau sẽ dọn tiếp
    }
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { items, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy thông báo');
    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền với thông báo này');
    }
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'Đã đánh dấu tất cả đã đọc' };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy thông báo');
    if (existing.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền với thông báo này');
    }
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Đã xoá thông báo' };
  }

  /** Dùng nội bộ bởi các module khác (reminder, check-in...) để tạo thông báo — không expose qua API. */
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    // H3: người dùng đã tắt loại này thì không tạo (thông báo thanh toán luôn gửi)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    if (isNotificationDisabled(user?.notificationPrefs, type)) return null;
    return this.prisma.notification.create({
      data: { userId, type, title, message },
    });
  }
}
