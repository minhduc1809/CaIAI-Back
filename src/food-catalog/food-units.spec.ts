import { normalizeUnits, parseServing, per100g, portionsFor, unitsOf } from './food-units';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';

describe('Đơn vị khẩu phần (BR-08.2)', () => {
  it('đọc số gram từ chuỗi khẩu phần', () => {
    expect(parseServing('1 chén (130g)')).toEqual({ label: '1 chén', grams: 130 });
    expect(parseServing('1 ly (250ml)')).toEqual({ label: '1 ly', grams: 250 });
    expect(parseServing('1 tô (500 g)').grams).toBe(500);
    expect(parseServing('1 phần').grams).toBeNull();
    expect(parseServing('150g')).toEqual({ label: '1 phần', grams: 150 });
    expect(parseServing('1 củ vừa (150g)').label).toBe('1 củ vừa');
  });

  it('dựng đơn vị mặc định + gram từ khẩu phần chuẩn', () => {
    const u = unitsOf('1 chén (130g)');
    expect(u).toEqual([
      { name: '1 chén', grams: 130, isDefault: true },
      { name: 'gram', grams: 1, isDefault: false },
    ]);
  });

  it('khẩu phần không có gram thì không bịa số, không có đơn vị gram', () => {
    expect(unitsOf('1 phần')).toEqual([]);
  });

  it('dùng đơn vị admin đã lưu và vẫn thêm gram', () => {
    const u = unitsOf('1 tô (500g)', [
      { name: 'tô nhỏ', grams: 350 },
      { name: 'tô lớn', grams: 650, isDefault: true },
    ]);
    expect(u.map((x) => x.name)).toEqual(['tô nhỏ', 'tô lớn', 'gram']);
    expect(u.filter((x) => x.isDefault)).toHaveLength(1);
    expect(u.find((x) => x.isDefault)!.name).toBe('tô lớn');
  });

  it('quy đổi sang số phần chuẩn', () => {
    expect(portionsFor(130, 1, 200)).toBeCloseTo(1.538, 3);
    expect(portionsFor(500, 650, 1)).toBe(1.3);
    expect(portionsFor(null, 1, 100)).toBeNull();
    expect(portionsFor(130, 1, 0)).toBeNull();
  });

  it('số liệu trên 100 g', () => {
    expect(per100g(130, { calories: 165, protein: 3.2, carb: 35, fat: 0.4 })).toEqual({
      calories: 126.9, protein: 2.5, carb: 26.9, fat: 0.3,
    });
    expect(per100g(null, { calories: 1, protein: 1, carb: 1, fat: 1 })).toBeNull();
  });

  it('từ chối đơn vị sai', () => {
    expect(normalizeUnits([{ name: '', grams: 10 }]).error).toBeDefined();
    expect(normalizeUnits([{ name: 'a', grams: 0 }]).error).toBeDefined();
    expect(normalizeUnits([{ name: 'a', grams: 99999 }]).error).toBeDefined();
    expect(normalizeUnits([{ name: 'a', grams: 5 }, { name: 'A', grams: 6 }]).error).toBeDefined();
    expect(normalizeUnits('x').error).toBeDefined();
  });

  it('phần lớn món trong kho gốc có số gram đọc được', () => {
    const withGrams = VIETNAMESE_FOODS_DATA.filter((f) => parseServing(f.servingSize).grams !== null).length;
    expect(withGrams / VIETNAMESE_FOODS_DATA.length).toBeGreaterThan(0.6);
  });
});
