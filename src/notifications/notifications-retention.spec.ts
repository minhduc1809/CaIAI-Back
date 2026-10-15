import { NOTIFICATION_RETENTION_DAYS, NotificationsService } from './notifications.service';

describe('Dọn thông báo cũ hơn 30 ngày (BR-13.1)', () => {
  const NOW = new Date('2026-10-12T03:00:00Z');
  const build = (deleteMany: jest.Mock = jest.fn(async () => ({ count: 0 }))) => {
    const prisma: any = {
      notification: {
        deleteMany,
        findMany: jest.fn(async () => [{ id: 'n1' }]),
        count: jest.fn(async () => 1),
      },
    };
    return { service: new NotificationsService(prisma), prisma };
  };

  it('xoá đúng thông báo của người dùng cũ hơn 30 ngày khi mở danh sách', async () => {
    const { service, prisma } = build();
    await service.list('u1', NOW);
    const where = prisma.notification.deleteMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(NOTIFICATION_RETENTION_DAYS).toBe(30);
    expect(where.createdAt.lt.toISOString()).toBe('2026-09-12T03:00:00.000Z');
  });

  it('chỉ dọn của chính người dùng đó, không đụng thông báo người khác', async () => {
    const { service, prisma } = build();
    await service.list('u2', NOW);
    expect(prisma.notification.deleteMany.mock.calls[0][0].where.userId).toBe('u2');
  });

  it('dọn lỗi thì vẫn trả danh sách bình thường', async () => {
    const { service } = build(jest.fn(async () => {
      throw new Error('db down');
    }));
    const res = await service.list('u1', NOW);
    expect(res.items).toHaveLength(1);
    expect(res.unreadCount).toBe(1);
  });
});
