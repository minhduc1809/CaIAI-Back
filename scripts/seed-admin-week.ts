/**
 * Script 1-lần: tạo dữ liệu bữa ăn THẬT cho tài khoản admin trong 7 ngày gần nhất (hôm nay -6 → hôm nay),
 * ghi thẳng vào Postgres qua Prisma — để AppDateStrip có hasData thật thay vì phải tự tay log từng bữa.
 * Chạy: npx ts-node scripts/seed-admin-week.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type ItemSeed = { name: string; servingSize: string; calories: number; protein: number; carb: number; fat: number };

const BREAKFAST: ItemSeed[] = [
  { name: 'Phở bò', servingSize: '1 tô đầy', calories: 480, protein: 28, carb: 60, fat: 14 },
  { name: 'Bánh mì trứng ốp la', servingSize: '1 ổ + 2 quả', calories: 520, protein: 22, carb: 55, fat: 24 },
  { name: 'Xôi gà', servingSize: '1 phần', calories: 450, protein: 20, carb: 65, fat: 12 },
];
const LUNCH: ItemSeed[] = [
  { name: 'Cơm gà', servingSize: '1 đĩa đầy', calories: 680, protein: 40, carb: 75, fat: 20 },
  { name: 'Cơm sườn nướng', servingSize: '1 đĩa đầy', calories: 720, protein: 35, carb: 80, fat: 26 },
  { name: 'Bún chả', servingSize: '1 tô lớn', calories: 600, protein: 32, carb: 65, fat: 18 },
];
const DINNER: ItemSeed[] = [
  { name: 'Cá hồi áp chảo + cơm', servingSize: '200g + 1 chén cơm', calories: 520, protein: 38, carb: 45, fat: 24 },
  { name: 'Ức gà + khoai lang', servingSize: '200g + 150g', calories: 480, protein: 42, carb: 40, fat: 14 },
  { name: 'Canh rau củ thịt bò', servingSize: '1 tô', calories: 320, protein: 20, carb: 25, fat: 12 },
];
const SNACK: ItemSeed[] = [
  { name: 'Sữa chua + granola', servingSize: '1 hũ', calories: 220, protein: 10, carb: 28, fat: 7 },
  { name: 'Chuối + hạt óc chó', servingSize: '1 quả + 20g', calories: 240, protein: 6, carb: 30, fat: 11 },
];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function toDateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

async function createMealFor(userId: string, date: Date, mealType: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK', item: ItemSeed) {
  await prisma.meal.create({
    data: {
      userId,
      mealType,
      date,
      logDate: new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
      totalCalories: item.calories,
      totalProtein: item.protein,
      totalCarb: item.carb,
      totalFat: item.fat,
      items: {
        create: [
          {
            name: item.name,
            servingSize: item.servingSize,
            quantity: 1,
            calories: item.calories,
            protein: item.protein,
            carb: item.carb,
            fat: item.fat,
            source: 'manual',
          },
        ],
      },
    },
  });
}

/** Thứ Hai của tuần chứa `date` — khớp đúng logic `generateWeekDays()` phía Android (firstDayOfWeek=MONDAY). */
function mondayOfWeek(date: Date): Date {
  const d = toDateOnly(date);
  const dow = d.getDay(); // 0=CN..6=T7
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { username: 'admin' } });
  if (!admin) {
    console.error('Không tìm thấy user username="admin". Dừng script.');
    process.exit(1);
  }

  const today = toDateOnly(new Date());
  const monday = mondayOfWeek(today);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  console.log(`Seed dữ liệu THẬT cho admin (id=${admin.id}) — tuần ${fmt(monday)} → ${fmt(sunday)} (Thứ Hai → hôm nay=${fmt(today)}, các ngày sau hôm nay bỏ qua vì chưa tới).`);

  // Xoá meal cũ của admin trong đúng tuần đang hiển thị để chạy lại script không bị trùng lặp.
  const endWindow = new Date(sunday);
  endWindow.setHours(23, 59, 59, 999);
  await prisma.meal.deleteMany({
    where: { userId: admin.id, date: { gte: monday, lte: endWindow } },
  });

  for (let offset = 0; offset <= 6; offset++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + offset);
    if (day > today) break; // không tạo dữ liệu cho ngày tương lai — đó là fake data

    const isToday = day.getTime() === today.getTime();
    // Hôm nay (đang diễn ra) chỉ log bữa sáng — thực tế hơn là đủ 3 bữa ngay từ sáng.
    // Các ngày đã qua: offset chẵn (28/9, 30/9, 2/10) thêm bữa phụ → đạt mục tiêu calo thật;
    // offset lẻ (29/9, 1/10) chỉ 3 bữa chính → chưa đạt — tạo đa dạng trạng thái thật, không đều tăm tắp.
    const mealsToLog: Array<['BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK', ItemSeed]> = isToday
      ? [['BREAKFAST', pick(BREAKFAST, offset)]]
      : offset % 2 === 0
        ? [
            ['BREAKFAST', pick(BREAKFAST, offset)],
            ['LUNCH', pick(LUNCH, offset)],
            ['DINNER', pick(DINNER, offset)],
            ['SNACK', pick(SNACK, offset)],
          ]
        : [
            ['BREAKFAST', pick(BREAKFAST, offset)],
            ['LUNCH', pick(LUNCH, offset)],
            ['DINNER', pick(DINNER, offset)],
          ];

    for (const [mealType, item] of mealsToLog) {
      await createMealFor(admin.id, day, mealType, item);
    }
    console.log(`  ${fmt(day)}: ${mealsToLog.map((m) => m[0]).join(', ')}`);
  }

  console.log('Xong — dữ liệu thật đã nằm trong bảng Meal/MealItem, đúng tuần Thứ Hai→Chủ Nhật đang hiển thị trên Home.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
