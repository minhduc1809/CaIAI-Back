import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ALLERGEN_CODES } from '../recommendations/data/food-safety-tags.data';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (value: any) => pipe.transform(value, { type: 'body', metatype: UpdateProfileDto });

describe('P1 Dị ứng chỉ nhận mã chuẩn (tránh dị ứng bị bỏ sót âm thầm)', () => {
  it('mọi mã chuẩn đều hợp lệ, kể cả chọn tất cả', async () => {
    await expect(validate({ allergies: [...ALLERGEN_CODES] })).resolves.toBeDefined();
    await expect(validate({ allergies: [] })).resolves.toBeDefined();
    await expect(validate({ allergies: ['PEANUT'] })).resolves.toBeDefined();
  });

  it.each([['Hải sản'], ['đậu phộng'], ['peanut'], ['SEAFOOD'], ['']])('từ chối giá trị tự do: %p', async (bad) => {
    await expect(validate({ allergies: [bad] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('một giá trị sai trong danh sách làm cả danh sách bị từ chối', async () => {
    await expect(validate({ allergies: ['EGG', 'Hải sản'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mã trùng lặp bị từ chối', async () => {
    await expect(validate({ allergies: ['EGG', 'EGG'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('danh sách mã khớp đúng với bộ lọc an toàn thực phẩm (mỗi mã đều có ít nhất một món gắn chất đó)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FOOD_SAFETY_TAGS } = require('../recommendations/data/food-safety-tags.data');
    const used = new Set<string>();
    for (const tags of Object.values(FOOD_SAFETY_TAGS) as any[]) tags.allergens.forEach((a: string) => used.add(a));
    for (const code of used) expect(ALLERGEN_CODES as readonly string[]).toContain(code);
  });
});
