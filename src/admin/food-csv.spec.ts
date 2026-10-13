import { parseCsv, validateCsvFoods } from './food-csv';
import { AdminFoodImportService } from './services/admin-food-import.service';

const HEAD = 'name,category,servingSize,calories,protein,carb,fat,allergens,containsMeat,containsFish,containsEgg,containsDairy,containsPork,dataSource,aliases,note';
const ok = (name: string) => `${name},Bánh,1 cái (80g),200,5,30,6,GLUTEN;EGG,false,false,true,false,false,Nhãn sản phẩm,"bánh a; bánh b","có dấu, phẩy"`;

describe('Nhập CSV kho món (J2)', () => {
  it('đọc CSV có ngoặc kép, dấu phẩy và BOM', () => {
    const t = parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\n');
    expect(t).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('dòng hợp lệ được nhận, aliases tách bằng ;', () => {
    const r = validateCsvFoods(`${HEAD}\n${ok('Bánh bông lan')}`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: 'Bánh bông lan', allergens: ['GLUTEN', 'EGG'], containsEgg: true, aliases: ['bánh a', 'bánh b'], note: 'có dấu, phẩy' });
  });

  it('báo lỗi theo dòng: thiếu thẻ, mã dị ứng sai, số ngoài khoảng, trùng tên', () => {
    const bad = 'Món X,Nhóm,1 phần,9999,1,1,1,PEANUTS,maybe,false,false,false,false,Nguồn';
    const r = validateCsvFoods(`${HEAD}\n${ok('A')}\n${bad}\n${ok('a')}`);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.errors[0].message).toContain('calories');
    expect(r.errors[0].message).toContain('PEANUTS');
    expect(r.errors[0].message).toContain('containsMeat');
    expect(r.errors[1].message).toContain('Trùng tên');
  });

  it('thiếu cột bắt buộc thì từ chối cả file', () => {
    const r = validateCsvFoods('name,category\nA,B');
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain('Thiếu cột');
  });
});

describe('Hai bước xem trước và xác nhận', () => {
  function build() {
    const created: any[] = [];
    const prisma: any = {
      foodCatalog: {
        findMany: jest.fn(async () => [{ name: 'Có sẵn' }]),
        createMany: jest.fn(async ({ data }: any) => (created.push(...data), { count: data.length })),
      },
    };
    const catalog: any = { invalidate: jest.fn() };
    const audit: any = { logAction: jest.fn() };
    return { svc: new AdminFoodImportService(prisma, audit, catalog), created, catalog };
  }

  it('xem trước không ghi gì; xác nhận mới ghi, bỏ món đã có, gắn thẻ an toàn', async () => {
    const t = build();
    const csv = `${HEAD}\n${ok('Mới 1')}\n${ok('Có sẵn')}`;
    const p = await t.svc.preview({ id: 'a1' }, csv);
    expect(t.created).toHaveLength(0);
    expect(p).toMatchObject({ total: 2, valid: 2, willCreate: 1, skippedExisting: ['Có sẵn'] });
    const c = await t.svc.commit({ id: 'a1' }, p.importId);
    expect(c.created).toBe(1);
    expect(t.created[0]).toMatchObject({ name: 'Mới 1', safetyTagged: true, source: 'OFFICIAL' });
    expect(t.catalog.invalidate).toHaveBeenCalled();
  });

  it('chỉ người tạo xác nhận được và chỉ một lần', async () => {
    const t = build();
    const p = await t.svc.preview({ id: 'a1' }, `${HEAD}\n${ok('Mới 2')}`);
    await expect(t.svc.commit({ id: 'a2' }, p.importId)).rejects.toThrow('không tồn tại');
    await t.svc.commit({ id: 'a1' }, p.importId);
    await expect(t.svc.commit({ id: 'a1' }, p.importId)).rejects.toThrow('không tồn tại');
  });
});
