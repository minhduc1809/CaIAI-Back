import { ExerciseCatalogService } from './exercise-catalog.service';
import { AdminExercisesService } from '../admin/services/admin-exercises.service';
import { FEMALE_EXERCISES, MALE_EXERCISES } from '../recommendations/data/gender-exercises.data';

function build(opts: { dbDown?: boolean } = {}) {
  const rows = new Map<string, any>();
  const audits: any[] = [];
  const prisma: any = {
    exerciseCatalog: {
      createMany: jest.fn(async ({ data }: any) => {
        if (opts.dbDown) throw new Error('db down');
        data.forEach((d: any) => !rows.has(d.id) && rows.set(d.id, { isActive: true, ...d }));
      }),
      findMany: jest.fn(async ({ where, skip = 0, take }: any = {}) => {
        let list = [...rows.values()];
        if (where?.isActive !== undefined) list = list.filter((r) => r.isActive === where.isActive);
        if (where?.nameNormalized?.contains) list = list.filter((r) => r.nameNormalized.includes(where.nameNormalized.contains));
        return list.slice(skip, take ? skip + take : undefined);
      }),
      count: jest.fn(async ({ where }: any = {}) => [...rows.values()].filter((r) => (where?.isActive === undefined ? true : r.isActive === where.isActive)).length),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => (rows.set(data.id, { isActive: true, ...data }), rows.get(data.id))),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.get(where.id), data)),
    },
  };
  const catalog = new ExerciseCatalogService(prisma);
  const audit: any = { logAction: jest.fn(async (a: any) => audits.push(a)) };
  return { catalog, admin: new AdminExercisesService(prisma, audit, catalog), rows, audits };
}

const TOTAL = MALE_EXERCISES.length + FEMALE_EXERCISES.length;

describe('Kho bài tập trong DB (F1)', () => {
  it('lần đầu nạp toàn bộ bài có sẵn, nạp lại không nhân đôi', async () => {
    const t = build();
    expect((await t.catalog.getAll()).length).toBe(TOTAL);
    await t.catalog.ensureSeeded();
    expect(t.rows.size).toBe(TOTAL);
  });

  it('không ghi đè bài admin đã sửa khi nạp lại', async () => {
    const t = build();
    await t.catalog.getAll();
    const id = MALE_EXERCISES[0].id;
    await t.admin.update({ id: 'a1' }, id, { name: 'Tên mới do admin' });
    (t.catalog as any).seeded = false; // mô phỏng khởi động lại
    t.catalog.invalidate();
    const item = await t.catalog.getById(id);
    expect(item?.name).toBe('Tên mới do admin');
  });

  it('ẩn bài thì biến khỏi danh sách nhưng không xoá hẳn; ghi nhật ký', async () => {
    const t = build();
    await t.catalog.getAll();
    const id = FEMALE_EXERCISES[0].id;
    await t.admin.deactivate({ id: 'a1', email: 'a@x.vn' }, id);
    expect(await t.catalog.getById(id)).toBeUndefined();
    expect(t.rows.get(id).isActive).toBe(false);
    expect(t.audits[0]).toMatchObject({ action: 'HIDE_EXERCISE', targetId: id });
    expect((await t.catalog.getAll()).length).toBe(TOTAL - 1);
  });

  it('thêm bài mới: có trong danh sách và giữ đủ hướng dẫn', async () => {
    const t = build();
    await t.catalog.getAll();
    const r = await t.admin.create({ id: 'a1' }, {
      name: 'Plank nghiêng', genderTarget: 'ALL', level: 'BEGINNER', targetMuscle: 'Core', equipment: 'NO_EQUIPMENT',
      sets: 3, repsOrDuration: '30 giây', restSeconds: 45, caloriesBurnedEstimate: 12,
      instructions: { preparation: 'a', execution: 'b', commonMistakes: 'c', breathing: 'd' },
    });
    const item = await t.catalog.getById(r.exercise.id);
    expect(item).toMatchObject({ name: 'Plank nghiêng', genderTarget: 'ALL', instructions: { execution: 'b' } });
  });

  it('sửa một phần hướng dẫn không làm mất các phần còn lại', async () => {
    const t = build();
    await t.catalog.getAll();
    const id = MALE_EXERCISES[0].id;
    await t.admin.update({ id: 'a1' }, id, { instructions: { breathing: 'Thở đều' } });
    const item = await t.catalog.getById(id);
    expect(item?.instructions.breathing).toBe('Thở đều');
    expect(item?.instructions.execution).toBe(MALE_EXERCISES[0].instructions.execution);
  });

  it('DB lỗi thì dùng kho trong code, app vẫn chạy', async () => {
    const t = build({ dbDown: true });
    expect((await t.catalog.getAll()).length).toBe(TOTAL);
  });

  it('PATCH không có thay đổi bị từ chối', async () => {
    const t = build();
    await t.catalog.getAll();
    await expect(t.admin.update({ id: 'a1' }, MALE_EXERCISES[0].id, {})).rejects.toThrow('Không có thay đổi');
  });
});
