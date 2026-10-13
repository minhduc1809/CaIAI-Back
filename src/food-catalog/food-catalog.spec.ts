import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { FoodCatalogService, DEFAULT_FOOD_CATEGORIES, staticCatalog } from './food-catalog.service';
import { searchCatalog } from './food-catalog.search';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';
import { FOOD_SAFETY_TAGS } from '../recommendations/data/food-safety-tags.data';
import { getAllowedFoods } from '../recommendations/food-safety';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AdminFoodsService } from '../admin/services/admin-foods.service';
import { AdminCreateFoodDto, AdminUpdateFoodDto } from '../admin/dto/admin-food.dto';

/** Prisma giả cho FoodCatalog: lưu bảng trong bộ nhớ. */
function fakePrisma(initial: any[] = []) {
  const rows: any[] = initial.map((r, i) => ({ id: `id${i}`, isActive: true, createdAt: new Date(1000 + i), ...r }));
  const prisma: any = {
    foodCatalog: {
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let n = 0;
        for (const d of data) {
          if (skipDuplicates && rows.some((r) => r.name === d.name)) continue;
          rows.push({ id: `id${rows.length}`, isActive: true, ...d });
          n++;
        }
        return { count: n };
      }),
      findMany: jest.fn(async ({ where }: any = {}) =>
        rows
          .filter((r) => (where?.isActive === undefined ? true : r.isActive === where.isActive))
          .sort((a, b) => +a.createdAt - +b.createdAt || a.name.localeCompare(b.name)),
      ),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.name === where.name && (!where.NOT || r.id !== where.NOT.id)) ?? null),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = rows.find((r) => r.id === where.id);
        return row ? { ...row } : null; // bản sao: giống cơ sở dữ liệu thật, bản "trước" không bị đổi theo
      }),
      count: jest.fn(async () => rows.length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `id${rows.length}`, isActive: true, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
  return { prisma, rows };
}

describe('Tìm kiếm trong kho (BR-08.1)', () => {
  const foods = staticCatalog();

  const oldSearch = (q: string) => {
    const lower = q.toLowerCase().trim();
    return VIETNAMESE_FOODS_DATA.filter(
      (f) => f.name.toLowerCase().includes(lower) || (f.note && f.note.toLowerCase().includes(lower)),
    ).map((f) => f.name);
  };

  it.each(['phở', 'cơm', 'gà', 'bò', 'canh', 'cá', 'trứng', 'tôm', 'chuối', 'sữa', 'bún', 'đậu phụ', 'rau', 'nước'])(
    'mọi kết quả của cách tìm cũ cho "%s" vẫn có mặt (chỉ thêm, không mất)',
    (q) => {
      const now = searchCatalog(foods, q).map((f) => f.name);
      for (const name of oldSearch(q)) expect(now).toContain(name);
    },
  );

  it.each([['pho bo'], ['phở bò'], ['PHO BO'], ['Phở Bò']])('"%s" ra các món phở bò', (q) => {
    const names = searchCatalog(foods, q).map((f) => f.name);
    expect(names).toContain('Phở bò tái nạc');
    expect(names).toContain('Phở bò nạm gầu');
  });

  it('gõ không dấu "pho" ra phở, "com" ra cơm, "dau hu" ra đậu phụ nhờ tên gọi khác', () => {
    expect(searchCatalog(foods, 'pho').some((f) => f.name.startsWith('Phở'))).toBe(true);
    expect(searchCatalog(foods, 'com')[0].name).toMatch(/^Cơm/);
    expect(searchCatalog(foods, 'dau hu').some((f) => f.name.startsWith('Đậu phụ'))).toBe(true);
  });

  it('món khớp đầu tên xếp trước món chỉ chứa chuỗi', () => {
    const names = searchCatalog(foods, 'bun').map((f) => f.name);
    expect(names[0]).toMatch(/^Bún/);
  });

  it('gõ sai nhẹ vẫn ra món gần giống, nhưng chuỗi không liên quan thì không ra gì', () => {
    expect(searchCatalog(foods, 'bun bo hue').length).toBeGreaterThan(0);
    expect(searchCatalog(foods, 'zzzzqqq')).toEqual([]);
  });

  it('lọc theo nhóm và kết hợp với từ khoá; không từ khoá thì trả đúng thứ tự kho', () => {
    const cat = 'Trái cây - Đồ uống';
    expect(searchCatalog(foods, undefined, cat).every((f) => f.category === cat)).toBe(true);
    expect(searchCatalog(foods).map((f) => f.name)).toEqual(VIETNAMESE_FOODS_DATA.map((f) => f.name));
    const names = searchCatalog(foods, 'chuoi', cat).map((f) => f.name);
    expect(names[0]).toBe('Chuối tiêu chín'); // khớp đầu tên xếp trước
    expect(names).toContain('Sinh tố bơ chuối sữa tươi');
  });
});

describe('Kho trong code tương đương kho mới', () => {
  it('73 món, tên và id duy nhất, mọi món đều đã gắn thẻ an toàn', () => {
    const foods = staticCatalog();
    expect(foods).toHaveLength(VIETNAMESE_FOODS_DATA.length);
    expect(new Set(foods.map((f) => f.name)).size).toBe(foods.length);
    expect(foods.every((f) => f.safetyTagged)).toBe(true);
    expect(Object.keys(FOOD_SAFETY_TAGS)).toHaveLength(foods.length);
  });

  it('danh mục mặc định chứa mọi nhóm đang dùng trong kho', () => {
    for (const f of staticCatalog()) expect(DEFAULT_FOOD_CATEGORIES).toContain(f.category);
  });
});

describe('FoodCatalogService', () => {
  it('lần đầu nạp 73 món (idempotent), đọc ra đúng thứ tự kho cũ', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    const foods = await svc.getFoods();
    expect(rows).toHaveLength(VIETNAMESE_FOODS_DATA.length);
    expect(foods.map((f) => f.name)).toEqual(VIETNAMESE_FOODS_DATA.map((f) => f.name));
    // Nạp lại ở phiên bản dịch vụ khác không tạo bản trùng
    await new FoodCatalogService(prisma).getFoods();
    expect(rows).toHaveLength(VIETNAMESE_FOODS_DATA.length);
  });

  it('không ghi đè món admin đã sửa khi nạp lại', async () => {
    const { prisma, rows } = fakePrisma();
    const a = new FoodCatalogService(prisma);
    await a.getFoods();
    rows.find((r) => r.name === 'Cơm trắng')!.calories = 999;
    const b = new FoodCatalogService(prisma);
    const foods = await b.getFoods();
    expect(foods.find((f) => f.name === 'Cơm trắng')!.calories).toBe(999);
  });

  it('bộ nhớ đệm: hai lần đọc chỉ truy vấn một lần; invalidate thì nạp lại', async () => {
    const { prisma } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    await svc.getFoods();
    await svc.getFoods();
    expect(prisma.foodCatalog.findMany).toHaveBeenCalledTimes(1);
    svc.invalidate();
    await svc.getFoods();
    expect(prisma.foodCatalog.findMany).toHaveBeenCalledTimes(2);
  });

  it('nhiều lời gọi đồng thời chỉ nạp một lần', async () => {
    const { prisma } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    await Promise.all([svc.getFoods(), svc.getFoods(), svc.getAllowedFoods({})]);
    expect(prisma.foodCatalog.findMany).toHaveBeenCalledTimes(1);
  });

  it('không đọc được cơ sở dữ liệu: dùng kho trong code, app vẫn chạy', async () => {
    const prisma: any = {
      foodCatalog: {
        createMany: jest.fn(async () => {
          throw new Error('db down');
        }),
        findMany: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const svc = new FoodCatalogService(prisma);
    const foods = await svc.getFoods();
    expect(foods).toHaveLength(VIETNAMESE_FOODS_DATA.length);
    expect((await svc.getAllowedFoods({ dietType: 'VEGAN' })).length).toBeGreaterThan(0);
  });

  it('món bị ẩn (isActive=false) không xuất hiện', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    await svc.getFoods();
    rows.find((r) => r.name === 'Cơm trắng')!.isActive = false;
    svc.invalidate();
    expect((await svc.getFoods()).map((f) => f.name)).not.toContain('Cơm trắng');
    expect((await svc.search('com trang')).map((f) => f.name)).not.toContain('Cơm trắng');
  });

  it('lọc an toàn cho kết quả Y HỆT hàm tĩnh cũ với mọi tổ hợp chế độ ăn và dị ứng', async () => {
    const { prisma } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    const diets = [null, 'OMNIVORE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL'];
    const allergyCombos = [[], ['PEANUT'], ['SOY', 'EGG'], ['DAIRY', 'FISH', 'SHELLFISH'], ['GLUTEN'], ['NONE']];
    for (const dietType of diets) {
      for (const allergies of allergyCombos) {
        const fromDb = (await svc.getAllowedFoods({ dietType, allergies })).map((f) => f.name);
        const fromStatic = getAllowedFoods({ dietType, allergies }).map((f) => f.name);
        expect(fromDb).toEqual(fromStatic);
      }
    }
  });

  it('FAIL-CLOSED: món chưa gắn thẻ an toàn không bao giờ lọt vào gợi ý, dù không vi phạm gì', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    await svc.getFoods();
    rows.find((r) => r.name === 'Cơm trắng')!.safetyTagged = false;
    svc.invalidate();
    expect((await svc.getAllowedFoods({})).map((f) => f.name)).not.toContain('Cơm trắng');
    // vẫn tra cứu được (chỉ gợi ý mới bị loại)
    expect((await svc.getFoods()).map((f) => f.name)).toContain('Cơm trắng');
  });

  it('bộ khớp tên dựng từ kho: món admin thêm với tên gọi khác khớp được', async () => {
    const { prisma, rows } = fakePrisma();
    rows.push({
      id: 'x1', isActive: true, name: 'Bánh xèo miền Tây', nameNormalized: 'banh xeo mien tay', aliases: ['bánh xèo'], category: 'Bún - Phở - Mì',
      servingSize: '1 cái', calories: 400, protein: 15, carb: 40, fat: 20, allergens: [], containsMeat: true, containsFish: true,
      containsEgg: false, containsDairy: false, containsPork: true, safetyTagged: true, source: 'OFFICIAL', createdAt: new Date(0),
    });
    const svc = new FoodCatalogService(prisma);
    const m = await svc.getMatcher();
    expect(m.best(['Bánh xèo'])?.food.name).toBe('Bánh xèo miền Tây');
  });

  it('danh mục: mặc định + nhóm mới do admin thêm', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new FoodCatalogService(prisma);
    await svc.getFoods();
    rows.push({
      id: 'n', isActive: true, name: 'Chè đậu xanh', nameNormalized: 'che dau xanh', aliases: [], category: 'Tráng miệng', servingSize: '1 chén',
      calories: 200, protein: 5, carb: 40, fat: 3, allergens: [], safetyTagged: true, source: 'OFFICIAL', createdAt: new Date(9e12),
    });
    svc.invalidate();
    const cats = await svc.categories();
    expect(cats.slice(0, 6)).toEqual(DEFAULT_FOOD_CATEGORIES);
    expect(cats).toContain('Tráng miệng');
  });
});

describe('RecommendationsService đọc từ kho mới', () => {
  it('tra cứu giữ nguyên hình dạng từng món; có kho thì tìm được không dấu', async () => {
    const { prisma } = fakePrisma();
    const catalog = new FoodCatalogService(prisma);
    const svc = new RecommendationsService({} as any, catalog);
    const res = await svc.searchFoodItems('pho bo');
    const item: any = res.data.items.find((i: any) => i.name === 'Phở bò tái nạc');
    expect(Object.keys(item).sort()).toEqual(['calories', 'carb', 'category', 'fat', 'name', 'note', 'per100g', 'protein', 'servingGrams', 'servingSize', 'units'].filter((k) => k in item).sort());
    expect(item).not.toHaveProperty('aliases');
    expect(res.data.total).toBe(res.data.items.length);
    const cats = await svc.getFoodCategories();
    expect(cats.data.slice(0, 6)).toEqual(DEFAULT_FOOD_CATEGORIES);
  });

  it('không có kho (môi trường test cũ): dùng cách tìm tĩnh như trước', async () => {
    const svc = new RecommendationsService({} as any);
    const res = await svc.searchFoodItems('phở');
    expect(res.data.items.length).toBeGreaterThan(0);
  });
});

describe('Quản trị kho món', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (value: any, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  const valid = {
    name: 'Bánh xèo', category: 'Bún - Phở - Mì', servingSize: '1 cái (150g)', calories: 400, protein: 15, carb: 40, fat: 20,
    allergens: ['SHELLFISH'], containsMeat: true, containsFish: true, containsEgg: false, containsDairy: false, containsPork: true,
    dataSource: 'Công thức chuẩn, chuyên gia dinh dưỡng rà soát',
  };

  it('DTO tạo món hợp lệ', async () => {
    await expect(validate(valid, AdminCreateFoodDto)).resolves.toMatchObject({ name: 'Bánh xèo' });
  });

  it.each([
    ['thiếu allergens', { allergens: undefined }],
    ['thiếu một cờ an toàn', { containsPork: undefined }],
    ['thiếu nguồn số liệu', { dataSource: '' }],
    ['mã dị ứng lạ', { allergens: ['TOMATO'] }],
    ['calo âm', { calories: -1 }],
    ['calo vô lý', { calories: 99999 }],
    ['tên rỗng', { name: '' }],
  ])('từ chối tạo món: %s', async (_n, patch) => {
    await expect(validate({ ...valid, ...patch }, AdminCreateFoodDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  const build = () => {
    const { prisma, rows } = fakePrisma();
    const audit: any = { logAction: jest.fn(async () => ({})) };
    const catalog = new FoodCatalogService(prisma);
    jest.spyOn(catalog, 'invalidate');
    return { svc: new AdminFoodsService(prisma, audit, catalog), prisma, rows, audit, catalog };
  };
  const admin = { id: 'a1', email: 'a@x.vn' };

  it('tạo món: đã gắn thẻ, chuẩn hoá tên, ghi nhật ký kiểm toán, làm mới bộ nhớ đệm', async () => {
    const { svc, rows, audit, catalog } = build();
    const res = await svc.create(admin, valid as any);
    expect(res.food).toMatchObject({ name: 'Bánh xèo', nameNormalized: 'banh xeo', safetyTagged: true });
    expect(rows).toHaveLength(1);
    expect(audit.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_FOOD', adminId: 'a1', targetType: 'FoodCatalog' }));
    expect(catalog.invalidate).toHaveBeenCalled();
    expect(res.warnings).toEqual([]);
  });

  it('cảnh báo mềm khi calo lệch Atwater nhưng vẫn lưu', async () => {
    const { svc } = build();
    const res = await svc.create(admin, { ...valid, calories: 1000 } as any);
    expect(res.warnings[0]).toMatch(/lệch hơn 15%/);
  });

  it('trùng tên → 409', async () => {
    const { svc } = build();
    await svc.create(admin, valid as any);
    await expect(svc.create(admin, valid as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sửa thẻ an toàn phải gửi đủ bộ; thiếu thì 400 và không ghi gì', async () => {
    const { svc, rows, audit } = build();
    const { food } = await svc.create(admin, valid as any);
    audit.logAction.mockClear();
    await expect(svc.update(admin, food.id, { containsPork: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update(admin, food.id, { allergens: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0].containsPork).toBe(true);
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('sửa đủ bộ thẻ, đổi tên, tên gọi khác; lưu trước/sau vào nhật ký', async () => {
    const { svc, rows, audit } = build();
    const { food } = await svc.create(admin, valid as any);
    const res = await svc.update(admin, food.id, {
      name: 'Bánh xèo tôm', aliases: ['banh xeo'], allergens: [], containsMeat: false, containsFish: false,
      containsEgg: false, containsDairy: false, containsPork: false,
    });
    expect(res.food).toMatchObject({ name: 'Bánh xèo tôm', nameNormalized: 'banh xeo tom', aliases: ['banh xeo'] });
    expect(rows[0].allergens).toEqual([]);
    const call = audit.logAction.mock.calls.at(-1)[0];
    expect(call.action).toBe('UPDATE_FOOD');
    expect(call.before.name).toBe('Bánh xèo');
    expect(call.after.name).toBe('Bánh xèo tôm');
  });

  it('sửa tên trùng món khác → 409; sửa món không tồn tại → 404', async () => {
    const { svc } = build();
    const a = await svc.create(admin, valid as any);
    await svc.create(admin, { ...valid, name: 'Bún riêu' } as any);
    await expect(svc.update(admin, a.food.id, { name: 'Bún riêu' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.update(admin, 'khong-co', { calories: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ẩn món thay vì xoá hẳn; món ẩn biến khỏi kho và ghi nhật ký', async () => {
    const { svc, rows, audit, catalog } = build();
    const { food } = await svc.create(admin, valid as any);
    await svc.deactivate(admin, food.id);
    expect(rows[0].isActive).toBe(false);
    expect(rows).toHaveLength(1);
    expect(audit.logAction).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'DEACTIVATE_FOOD' }));
    expect(catalog.invalidate).toHaveBeenCalled();
    await expect(svc.deactivate(admin, 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('món vừa tạo được gợi ý sau khi bộ nhớ đệm làm mới, và món sai thẻ không bị loại nhầm', async () => {
    const { prisma } = fakePrisma();
    const catalog = new FoodCatalogService(prisma);
    const svc = new AdminFoodsService(prisma, { logAction: jest.fn() } as any, catalog);
    await catalog.getFoods(); // nạp trước
    await svc.create(admin, { ...valid, containsMeat: true } as any);
    const vegan = (await catalog.getAllowedFoods({ dietType: 'VEGAN' })).map((f) => f.name);
    expect(vegan).not.toContain('Bánh xèo'); // có thịt/cá → loại với người ăn thuần chay
    const omni = (await catalog.getAllowedFoods({ dietType: 'OMNIVORE' })).map((f) => f.name);
    expect(omni).toContain('Bánh xèo');
    const shellfishAllergy = (await catalog.getAllowedFoods({ allergies: ['SHELLFISH'] })).map((f) => f.name);
    expect(shellfishAllergy).not.toContain('Bánh xèo');
  });

  it('danh sách phân trang, tìm không dấu, mặc định chỉ món đang bật', async () => {
    const { svc, rows } = build();
    await svc.create(admin, valid as any);
    const b = await svc.create(admin, { ...valid, name: 'Bún riêu' } as any);
    rows.find((r) => r.id === b.food.id)!.isActive = false;
    const list = await svc.list({ query: 'xeo' });
    expect(list.items.map((i: any) => i.name)).toEqual(['Bánh xèo']);
    const limited = await svc.list({ limit: 9999 });
    expect(limited.limit).toBe(100);
  });
});
