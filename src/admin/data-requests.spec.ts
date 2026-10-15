import { AdminDataRequestsService } from './services/admin-data-requests.service';

function build(userExists = true) {
  const rows: any[] = [];
  const prisma: any = {
    user: { findUnique: jest.fn(async () => (userExists ? { id: 'u1' } : null)) },
    dataRequest: {
      create: jest.fn(async ({ data }: any) => (rows.push({ id: `r${rows.length + 1}`, status: 'NEW', ...data }), rows[rows.length - 1])),
      count: jest.fn(async () => rows.length),
      findMany: jest.fn(async () => [...rows]),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
    },
  };
  const audit: any = { logAction: jest.fn() };
  return { svc: new AdminDataRequestsService(prisma, audit), rows, audit };
}

describe('Yêu cầu quyền dữ liệu', () => {
  it('ghi nhận: khớp tài khoản theo email, hạn 72 giờ, ghi nhật ký', async () => {
    const t = build();
    const now = new Date('2026-10-13T00:00:00Z');
    const r = await t.svc.create({ id: 'a1' }, { email: 'User@X.vn', type: 'DELETE' }, now);
    expect(r.matchedAccount).toBe(true);
    expect(t.rows[0]).toMatchObject({ email: 'user@x.vn', userId: 'u1' });
    expect(t.rows[0].dueAt.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(t.audit.logAction).toHaveBeenCalled();
  });

  it('email không khớp tài khoản vẫn ghi nhận nhưng userId trống', async () => {
    const t = build(false);
    const r = await t.svc.create({ id: 'a1' }, { email: 'a@b.vn', type: 'EXPORT' });
    expect(r.matchedAccount).toBe(false);
    expect(t.rows[0].userId).toBeNull();
  });

  it('đánh dấu quá hạn khi chưa xong và qua hạn', async () => {
    const t = build();
    await t.svc.create({ id: 'a1' }, { email: 'a@b.vn', type: 'EXPORT' }, new Date('2026-10-01T00:00:00Z'));
    const l = await t.svc.list({}, new Date('2026-10-13T00:00:00Z'));
    expect(l.items[0].overdue).toBe(true);
  });

  it('hoàn tất/từ chối bắt buộc ghi chú; đã đóng thì không sửa nữa', async () => {
    const t = build();
    await t.svc.create({ id: 'a1' }, { email: 'a@b.vn', type: 'EXPORT' });
    await expect(t.svc.update({ id: 'a1' }, 'r1', { status: 'REJECTED' })).rejects.toThrow('lý do');
    await expect(t.svc.update({ id: 'a1' }, 'r1', { status: 'DONE' })).rejects.toThrow('cách đã xử lý');
    await t.svc.update({ id: 'a1' }, 'r1', { status: 'IN_PROGRESS' });
    await t.svc.update({ id: 'a1' }, 'r1', { status: 'DONE', resultNote: 'Người dùng tự xuất trong app' });
    expect(t.rows[0].handledAt).toBeInstanceOf(Date);
    await expect(t.svc.update({ id: 'a1' }, 'r1', { status: 'NEW' })).rejects.toThrow('đã đóng');
  });
});
