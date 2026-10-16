/**
 * Script 1-lần: thêm "Trà đào hòa tan Cozy" vào FoodCatalog với số liệu đúng từ nhãn sản phẩm
 * (Khẩu phần 1 túi nhỏ 15g: 58,95 kcal, carb 14,5g, protein 0g, fat 0,08g).
 * Chạy: npx ts-node scripts/add-food-tra-dao-cozy.ts
 */
import { PrismaClient } from '@prisma/client';
import { normalizeName } from '../src/ai/food-matcher';

const prisma = new PrismaClient();

async function main() {
  const name = 'Trà đào hòa tan Cozy';
  const data = {
    name,
    nameNormalized: normalizeName(name),
    aliases: ['Cozy Ice Tea Trà Đào', 'Trà đào Cozy', 'Cozy trà đào hòa tan'],
    category: 'Trái cây - Đồ uống',
    servingSize: '1 túi nhỏ (15g)',
    calories: 58.95,
    protein: 0,
    carb: 14.5,
    fat: 0.08,
    note: 'Số liệu lấy từ bảng Giá trị dinh dưỡng in trên bao bì, khẩu phần 1 túi nhỏ (15g) pha nước.',
    allergens: [] as string[],
    containsMeat: false,
    containsFish: false,
    containsEgg: false,
    containsDairy: false,
    containsPork: false,
    safetyTagged: true,
    source: 'OFFICIAL',
    dataSource: 'Nhãn sản phẩm Cozy Ice Tea Trà Đào',
    units: [{ name: '1 túi nhỏ', grams: 15, isDefault: true }],
    isActive: true,
    needsReview: false,
  };

  const existing = await prisma.foodCatalog.findUnique({ where: { name } });
  if (existing) {
    const updated = await prisma.foodCatalog.update({ where: { id: existing.id }, data });
    console.log(`[Food Catalog] Cập nhật: ${updated.name} (${updated.id})`);
  } else {
    const created = await prisma.foodCatalog.create({ data });
    console.log(`[Food Catalog] Tạo mới: ${created.name} (${created.id})`);
  }
}

main()
  .catch((e) => {
    console.error('[Food Catalog] Lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
