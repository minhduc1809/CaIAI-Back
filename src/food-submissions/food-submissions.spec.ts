import { BadRequestException, ConflictException } from '@nestjs/common';
import { FoodSubmissionsService, MAX_PENDING_SUBMISSIONS } from './food-submissions.service';
import { AdminFoodSubmissionsService } from '../admin/services/admin-food-submissions.service';

/** Gửi món vào kho chung và duyệt (BR-08.5). */
function build(opts: { catalog?: any[]; custom?: any[] } = {}) {
  const subs: any[] = [];
  const catalogRows: any[] = [...(opts.catalog ?? [])];
  const notified: any[] = [];
  const audits: any[] = [];
  const prisma: any = {
    customFood: {
      findUnique: jest.fn(async ({ where }: any) => (opts.custom ?? []).find((c) => c.id === where.id) ?? null),
    },
    foodSubmission: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        subs.filter((s) => (!where?.userId || s.userId === where.userId) && (!where?.status || s.status === where.status)),
      ),
      findUnique: jest.fn(async ({ where }: any) => subs.find((s) => s.id === where.id) ?? null),
      count: jest.fn(async () => subs.length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `s${subs.length + 1}`, status: 'SUBMITTED', createdAt: new Date(), ...data };
        subs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(subs.find((s) => s.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = subs.filter((s) => s.id === where.id && (!where.status || s.status === where.status) && (!where.userId || s.userId === where.userId));
        hit.forEach((h) => Object.assign(h, data));
        return { count: hit.length };
      }),
    },
    foodCatalog: {
      findFirst: jest.fn(async ({ where }: any) => catalogRows.find((c) => c.name === where.name) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `f${catalogRows.length + 1}`, ...data };
        catalogRows.push(row);
        return row;
      }),
    },
  };
  const catalog: any = {
    getFoods: jest.fn(async () => catalogRows.map((c) => ({ ...c, aliases: c.aliases ?? [] }))),
    invalidate: jest.fn(),
  };
  const notifications: any = { create: jest.fn(async (...a: any[]) => notified.push(a)) };
  const audit: any = { logAction: jest.fn(async (a: any) => audits.push(a)) };
  return {
    user: new FoodSubmissionsService(prisma, catalog),
    admin: new AdminFoodSubmissionsService(prisma, audit, catalog, notifications),
    subs, catalogRows, notified, audits, catalog,
  };
}

const food = (over: any = {}) => ({
  id: 'k1', userId: 'u1', name: 'Bánh nhà làm', servingSize: '1 cái (80g)', calories: 200, protein: 5, carb: 30, fat: 6, barcode: null, ...over,
});
const tags = { category: 'Bánh', allergens: ['GLUTEN'], containsMeat: false, containsFish: false, containsEgg: true, containsDairy: false, containsPork: false };

describe('Người dùng gửi món', () => {
  it('gửi món của mình, trạng thái SUBMITTED, snapshot số liệu', async () => {
    const t = build({ custom: [food()] });
    const r = await t.user.submit('u1', 'k1', 'nhãn gói');
    expect(r.data).toMatchObject({ status: 'SUBMITTED', name: 'Bánh nhà làm', calories: 200, possibleDuplicate: false, note: 'nhãn gói' });
  });

  it('không gửi được món của người khác', async () => {
    const t = build({ custom: [food({ userId: 'u2' })] });
    await expect(t.user.submit('u1', 'k1')).rejects.toThrow('Không tìm thấy');
  });

  it('tên giống món có sẵn thì gắn cờ nghi trùng nhưng vẫn cho gửi', async () => {
    const t = build({ custom: [food({ name: 'Phở bò' })], catalog: [{ id: 'f1', name: 'Phở bò', aliases: [] }] });
    const r = await t.user.submit('u1', 'k1');
    expect(r.data).toMatchObject({ possibleDuplicate: true, duplicateOfName: 'Phở bò' });
  });

  it('không gửi hai lần cùng một món khi đang chờ', async () => {
    const t = build({ custom: [food()] });
    await t.user.submit('u1', 'k1');
    await expect(t.user.submit('u1', 'k1')).rejects.toBeInstanceOf(ConflictException);
  });

  it(`tối đa ${MAX_PENDING_SUBMISSIONS} món chờ duyệt`, async () => {
    const custom = Array.from({ length: MAX_PENDING_SUBMISSIONS + 1 }, (_, i) => food({ id: `k${i}`, name: `Món lạ số ${i} xyz` }));
    const t = build({ custom });
    for (let i = 0; i < MAX_PENDING_SUBMISSIONS; i++) await t.user.submit('u1', `k${i}`);
    await expect(t.user.submit('u1', `k${MAX_PENDING_SUBMISSIONS}`)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('huỷ khi còn chờ; đã duyệt thì không huỷ được', async () => {
    const t = build({ custom: [food()] });
    const { data } = await t.user.submit('u1', 'k1');
    await t.user.cancel('u1', data.id);
    expect(t.subs[0].status).toBe('CANCELED');
    await expect(t.user.cancel('u1', data.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Admin duyệt món', () => {
  it('duyệt: tạo món COMMUNITY trong kho, đổi trạng thái, báo người gửi, ghi kiểm toán', async () => {
    const t = build({ custom: [food()] });
    const { data } = await t.user.submit('u1', 'k1');
    const r = await t.admin.approve({ id: 'a1' }, data.id, { ...tags, calories: 210 } as any);
    expect(r.food).toMatchObject({ name: 'Bánh nhà làm', source: 'COMMUNITY', calories: 210, safetyTagged: true, category: 'Bánh' });
    expect(t.subs[0]).toMatchObject({ status: 'APPROVED', reviewedBy: 'a1', catalogFoodId: r.food.id });
    expect(t.notified[0].slice(0, 2)).toEqual(['u1', 'FOOD_SUBMISSION_RESULT']);
    expect(t.audits[0].action).toBe('APPROVE_FOOD_SUBMISSION');
    expect(t.catalog.invalidate).toHaveBeenCalled();
  });

  it('trùng tên trong kho thì không duyệt và giữ trạng thái chờ', async () => {
    const t = build({ custom: [food()], catalog: [{ id: 'f1', name: 'Bánh nhà làm' }] });
    const { data } = await t.user.submit('u1', 'k1');
    await expect(t.admin.approve({ id: 'a1' }, data.id, tags as any)).rejects.toBeInstanceOf(ConflictException);
    expect(t.subs[0].status).toBe('SUBMITTED');
  });

  it('từ chối cần lý do, người gửi nhận thông báo kèm lý do', async () => {
    const t = build({ custom: [food()] });
    const { data } = await t.user.submit('u1', 'k1');
    await t.admin.reject({ id: 'a1' }, data.id, 'Sai calo');
    expect(t.subs[0]).toMatchObject({ status: 'REJECTED', rejectReason: 'Sai calo' });
    expect(t.notified[0][3]).toContain('Sai calo');
  });

  it('món đã xử lý thì không duyệt hoặc từ chối lần nữa', async () => {
    const t = build({ custom: [food()] });
    const { data } = await t.user.submit('u1', 'k1');
    await t.admin.reject({ id: 'a1' }, data.id, 'x');
    await expect(t.admin.approve({ id: 'a1' }, data.id, tags as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(t.admin.reject({ id: 'a1' }, data.id, 'y')).rejects.toBeInstanceOf(ConflictException);
  });

  it('người dùng huỷ thì admin không duyệt được', async () => {
    const t = build({ custom: [food()] });
    const { data } = await t.user.submit('u1', 'k1');
    await t.user.cancel('u1', data.id);
    await expect(t.admin.approve({ id: 'a1' }, data.id, tags as any)).rejects.toBeInstanceOf(ConflictException);
  });
});
