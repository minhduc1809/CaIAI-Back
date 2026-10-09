import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
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
    const existing = await this.prisma.notification.findUnique({ where: { id } });
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
    const existing = await this.prisma.notification.findUnique({ where: { id } });
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
    return this.prisma.notification.create({
      data: { userId, type, title, message },
    });
  }
}
