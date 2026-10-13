import {
  FoodMatcher,
  atwaterCheck,
  nameSimilarity,
  normalizeName,
  portionFactor,
  servingGrams,
} from './food-matcher';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';
import { FOOD_ALIASES } from './food-aliases.data';

describe('Chuẩn hoá tên món', () => {
  it('bỏ dấu, chữ thường, bỏ ký tự đặc biệt', () => {
    expect(normalizeName('Phở Bò (Tái)')).toBe('pho bo tai');
    expect(normalizeName('  Đậu hũ — sốt cà  ')).toBe('dau hu sot ca');
    expect(normalizeName('Khoai tây hấp / luộc')).toBe('khoai tay hap luoc');
  });

  it('cùng chữ khác dấu/hoa thường thì giống nhau tuyệt đối', () => {
    expect(nameSimilarity('Phở bò', 'PHO BO')).toBe(1);
  });
});

describe('Khớp món với kho (ngưỡng 0,6)', () => {
  const matcher = new FoodMatcher();
  const best = (...names: string[]) => matcher.best(names)?.food.name ?? null;

  it.each([
    ['Phở bò', 'Phở bò tái nạc'],
    ['pho bo', 'Phở bò tái nạc'],
    ['Cơm trắng', 'Cơm trắng'],
    ['cơm', 'Cơm trắng'],
    ['Trứng ốp la', 'Trứng gà ốp la ít dầu'],
    ['Trứng chiên', 'Trứng gà ốp la ít dầu'],
    ['Bún bò Huế', 'Bún bò Huế đầy đủ'],
    ['Bún chả', 'Bún chả Hà Nội (thịt nướng than)'],
    ['Bánh mì', 'Bánh mì truyền thống'],
    ['Cá hồi áp chảo', 'Cá hồi áp chảo sốt chanh leo'],
    ['Canh chua cá lóc', 'Canh chua cá lóc Nam Bộ'],
    ['Chuối', 'Chuối tiêu chín'],
    ['Sữa chua', 'Sữa chua men sống không đường'],
    ['Nước dừa', 'Nước dừa tươi nguyên chất'],
    ['Phở gà', 'Phở ức gà xé lá chanh'],
  ])('"%s" khớp "%s"', (query, expected) => {
    expect(best(query)).toBe(expected);
  });

  it('dùng tên gọi khác (possibleNames) khi tên chính không khớp', () => {
    expect(best('Món nước kiểu Huế', 'bún bò huế')).toBe('Bún bò Huế đầy đủ');
  });

  it.each([['Bánh xèo'], ['Cơm tấm sườn bì chả'], ['Pizza hải sản'], ['Gỏi cuốn'], ['Hamburger'], ['Mì Quảng']])(
    'món không có trong kho "%s" thì KHÔNG khớp bừa',
    (query) => {
      expect(best(query)).toBeNull();
    },
  );

  it('trả về tối đa 3 món gần nhất, điểm giảm dần, không trùng', () => {
    const near = matcher.nearest(['phở bò'], 3);
    expect(near).toHaveLength(3);
    expect(near[0].score).toBeGreaterThanOrEqual(near[1].score);
    expect(near[1].score).toBeGreaterThanOrEqual(near[2].score);
    expect(new Set(near.map((n) => n.id)).size).toBe(3);
    expect(near.map((n) => n.food.name)).toContain('Phở bò nạm gầu');
  });

  it('mỗi món có sourceId ổn định, không trùng nhau', () => {
    const ids = VIETNAMESE_FOODS_DATA.map((f) => matcher.best([f.name], 0.99)?.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(VIETNAMESE_FOODS_DATA.length);
  });

  it('tên chính xác của từng món trong kho luôn khớp đúng món đó', () => {
    for (const f of VIETNAMESE_FOODS_DATA) {
      expect(matcher.best([f.name])?.food.name).toBe(f.name);
    }
  });

  it('tên rỗng hoặc toàn ký tự đặc biệt không khớp gì', () => {
    expect(matcher.best([''])).toBeNull();
    expect(matcher.best(['???', '...'])).toBeNull();
    expect(matcher.nearest([])).toEqual([]);
  });
});

describe('Alias trỏ đúng vào món có trong kho', () => {
  it('mọi khoá alias là tên món có thật (gõ sai tên sẽ làm alias vô hiệu âm thầm)', () => {
    const names = new Set(VIETNAMESE_FOODS_DATA.map((f) => f.name));
    for (const key of Object.keys(FOOD_ALIASES)) expect(names.has(key)).toBe(true);
  });
});

describe('Quy đổi khẩu phần', () => {
  it.each([
    ['1 chén (130g)', 130],
    ['100g', 100],
    ['150g', 150],
    ['1 đĩa (140g bò)', 140],
    ['40g khô (~1 tô)', 40],
    ['1 ly lớn (300ml)', 300],
    ['1 tô (200g ruột)', 200],
    ['1 tô vừa', null],
    ['2 quả trứng', null],
  ])('servingGrams("%s") = %p', (serving, expected) => {
    expect(servingGrams(serving)).toBe(expected);
  });

  it('đơn vị gram: chia cho gram chuẩn của kho', () => {
    expect(portionFactor({ amount: 260, unit: 'g' }, '1 chén (130g)')).toBe(2);
    expect(portionFactor({ amount: 50, unit: 'gam' }, '100g')).toBe(0.5);
  });

  it('đơn vị đếm: amount là số khẩu phần chuẩn', () => {
    expect(portionFactor({ amount: 1.5, unit: 'tô' }, '1 tô vừa')).toBe(1.5);
    expect(portionFactor({ amount: 2, unit: 'chén' }, '1 chén (130g)')).toBe(2);
  });

  it('gram nhưng kho không ghi gram: giữ hệ số 1', () => {
    expect(portionFactor({ amount: 400, unit: 'g' }, '1 tô vừa')).toBe(1);
  });

  it('chặn hệ số vô lý và giá trị sai', () => {
    expect(portionFactor({ amount: 500, unit: 'tô' }, '1 tô')).toBe(8);
    expect(portionFactor({ amount: 0.001, unit: 'tô' }, '1 tô')).toBe(0.1);
    expect(portionFactor({ amount: -3, unit: 'tô' }, '1 tô')).toBe(1);
    expect(portionFactor({ amount: NaN, unit: 'g' }, '100g')).toBe(1);
  });
});

describe('Kiểm tra Atwater', () => {
  it('lệch trong 15% thì đạt', () => {
    expect(atwaterCheck({ calories: 520, protein: 28, carb: 64, fat: 16 }).ok).toBe(true);
  });

  it('lệch hơn 15% thì không đạt và trả calo tính từ macro', () => {
    const r = atwaterCheck({ calories: 900, protein: 10, carb: 20, fat: 10 });
    expect(r.ok).toBe(false);
    expect(r.computed).toBe(210);
  });

  it('macro bằng 0 (nước lọc...) không chia cho 0', () => {
    expect(atwaterCheck({ calories: 0, protein: 0, carb: 0, fat: 0 }).ok).toBe(true);
  });
});
