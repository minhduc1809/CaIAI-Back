import { RecommendationsService } from './recommendations.service';

/** Yêu thích theo định danh món (BR-08.3): đổi tên món thì yêu thích vẫn còn, tên hiển thị là tên hiện tại. */
describe('Yêu thích theo định danh (BR-08.3)', () => {
  function build(catalogFoods: any[], customFoods: any[]) {
    const favs: any[] = [];
    const prisma: any = {
      favoriteFood: {
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const key = where.userId_foodName;
          const hit = favs.find((f) => f.userId === key.userId && f.foodName === key.foodName);
          if (hit) return Object.assign(hit, update);
          const row = { createdAt: new Date(), ...create };
          favs.push(row);
          return row;
        }),
        findMany: jest.fn(async () => [...favs]),
        deleteMany: jest.fn(async ({ where }: any) => {
          const before = favs.length;
          for (let i = favs.length - 1; i >= 0; i--) {
            const f = favs[i];
            const match = where.OR.some((c: any) =>
              c.foodName !== undefined ? f.foodName === c.foodName : f.sourceType === c.sourceType && f.sourceId === c.sourceId,
            );
            if (f.userId === where.userId && match) favs.splice(i, 1);
          }
          return { count: before - favs.length };
        }),
      },
      customFood: {
        findFirst: jest.fn(async ({ where }: any) =>
          customFoods.find((c) => c.userId === (where.userId ?? c.userId) && (where.id ? c.id === where.id : c.name === where.name)) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) => customFoods.filter((c) => where.id.in.includes(c.id))),
      },
    };
    const catalog: any = {
      findByIdOrName: jest.fn(async (ref: any) =>
        catalogFoods.find((f) => (ref.id && f.id === ref.id) || (ref.name && f.name.toLowerCase() === ref.name.toLowerCase())),
      ),
    };
    return { svc: new RecommendationsService(prisma, catalog), favs, catalogFoods, customFoods };
  }

  it('thêm món trong kho thì lưu mã, đổi tên món vẫn thấy yêu thích với tên mới', async () => {
    const t = build([{ id: 'c1', name: 'Phở bò' }], []);
    await t.svc.addFavoriteFood('u1', 'Phở bò');
    expect(t.favs[0]).toMatchObject({ sourceType: 'CATALOG', sourceId: 'c1' });
    t.catalogFoods[0].name = 'Phở bò tái';
    const res = await t.svc.getFavoriteFoods('u1');
    expect(res.data).toEqual(['Phở bò tái']);
  });

  it('món tự tạo: lưu mã và theo tên mới khi người dùng đổi tên', async () => {
    const t = build([], [{ id: 'k1', userId: 'u1', name: 'Bánh nhà làm' }]);
    await t.svc.addFavoriteFood('u1', 'Bánh nhà làm');
    expect(t.favs[0]).toMatchObject({ sourceType: 'CUSTOM', sourceId: 'k1' });
    t.customFoods[0].name = 'Bánh của mẹ';
    expect((await t.svc.getFavoriteFoods('u1')).data).toEqual(['Bánh của mẹ']);
  });

  it('không tra được món thì vẫn lưu theo tên như trước', async () => {
    const t = build([], []);
    await t.svc.addFavoriteFood('u1', 'Món lạ');
    expect(t.favs[0].sourceType).toBeUndefined();
    expect((await t.svc.getFavoriteFoods('u1')).data).toEqual(['Món lạ']);
  });

  it('bỏ yêu thích theo tên hiện tại cũng xoá bản ghi lưu tên cũ cùng định danh', async () => {
    const t = build([{ id: 'c1', name: 'Phở bò' }], []);
    await t.svc.addFavoriteFood('u1', 'Phở bò');
    t.catalogFoods[0].name = 'Phở bò tái';
    await t.svc.removeFavoriteFood('u1', 'Phở bò tái');
    expect(t.favs).toHaveLength(0);
  });

  it('không bị lặp khi hai bản ghi cùng trỏ một món', async () => {
    const t = build([{ id: 'c1', name: 'Phở bò' }], []);
    t.favs.push(
      { userId: 'u1', foodName: 'Phở bò', sourceType: 'CATALOG', sourceId: 'c1', createdAt: new Date() },
      { userId: 'u1', foodName: 'pho bo', sourceType: 'CATALOG', sourceId: 'c1', createdAt: new Date() },
    );
    expect((await t.svc.getFavoriteFoods('u1')).data).toEqual(['Phở bò']);
  });
});
