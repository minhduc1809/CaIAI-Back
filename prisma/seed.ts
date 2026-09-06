import { PrismaClient, Role, GoalType, MealType, ActivityLevel, MacroStyle } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Đang khởi tạo dữ liệu mẫu (Seeding) cho CalAI Backend...');

  // 1. Tạo tài khoản Admin (username: admin / password: admin)
  const salt = await bcrypt.genSalt(10);
  const adminHashed = await bcrypt.hash('admin', salt);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      password: adminHashed,
      role: Role.ADMIN,
      dailyAiQuota: 999999,
    },
    create: {
      username: 'admin',
      email: 'admin@calai.com',
      password: adminHashed,
      name: 'CalAI Administrator',
      role: Role.ADMIN,
      dailyAiQuota: 999999,
    },
  });
  console.log('✅ Đã sẵn sàng tài khoản Admin: admin / admin');

  // 2. Tạo tài khoản Test User (username: testuser / password: User@123456)
  const userPasswordHashed = await bcrypt.hash('User@123456', salt);

  const testUser = await prisma.user.upsert({
    where: { username: 'testuser' },
    update: {
      password: userPasswordHashed,
      name: 'Nguyễn Văn Minh',
      gender: 'MALE',
      dateOfBirth: new Date('1998-05-15'),
      heightCm: 175,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      activityLevel: ActivityLevel.MODERATELY_ACTIVE,
      goal: GoalType.LOSE_WEIGHT,
      macroStyle: MacroStyle.BALANCED,
      bmi: 22.86,
      bmr: 1680,
      tdee: 2350,
      targetCalories: 1850,
      targetProtein: 140,
      targetCarb: 200,
      targetFat: 55,
      dailyAiQuota: 50,
    },
    create: {
      username: 'testuser',
      email: 'user@calai.com',
      password: userPasswordHashed,
      name: 'Nguyễn Văn Minh',
      role: Role.USER,
      gender: 'MALE',
      dateOfBirth: new Date('1998-05-15'),
      heightCm: 175,
      weightKg: 70,
      targetWeightKg: 65,
      weightRateKgPerWeek: 0.5,
      activityLevel: ActivityLevel.MODERATELY_ACTIVE,
      goal: GoalType.LOSE_WEIGHT,
      macroStyle: MacroStyle.BALANCED,
      bmi: 22.86,
      bmr: 1680,
      tdee: 2350,
      targetCalories: 1850,
      targetProtein: 140,
      targetCarb: 200,
      targetFat: 55,
      dailyAiQuota: 50,
    },
  });
  console.log('✅ Đã sẵn sàng tài khoản Test User: testuser / User@123456');

  // 3. Xóa các bữa ăn cũ của testuser để tạo bữa ăn mẫu hôm nay
  await prisma.meal.deleteMany({
    where: { userId: testUser.id },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Bữa Sáng: Phở Bò Tái Nạm
  const breakfast = await prisma.meal.create({
    data: {
      userId: testUser.id,
      mealType: MealType.BREAKFAST,
      date: new Date(),
      totalCalories: 480,
      totalProtein: 32,
      totalCarb: 62,
      totalFat: 12,
      items: {
        create: [
          {
            name: 'Bánh phở tươi',
            servingSize: '200g',
            quantity: 1,
            calories: 220,
            protein: 4,
            carb: 48,
            fat: 1,
            source: 'ai_scan',
          },
          {
            name: 'Thịt bò tái nạm',
            servingSize: '120g',
            quantity: 1,
            calories: 200,
            protein: 26,
            carb: 0,
            fat: 10,
            source: 'ai_scan',
          },
          {
            name: 'Nước dùng & rau thơm',
            servingSize: '1 bát',
            quantity: 1,
            calories: 60,
            protein: 2,
            carb: 14,
            fat: 1,
            source: 'manual',
          },
        ],
      },
    },
  });

  // Bữa Trưa: Cơm Tấm Sườn Bì Chả
  const lunch = await prisma.meal.create({
    data: {
      userId: testUser.id,
      mealType: MealType.LUNCH,
      date: new Date(),
      totalCalories: 620,
      totalProtein: 34,
      totalCarb: 72,
      totalFat: 21,
      items: {
        create: [
          {
            name: 'Cơm tấm trắng',
            servingSize: '1 chén (160g)',
            quantity: 1,
            calories: 220,
            protein: 4,
            carb: 48,
            fat: 1,
            source: 'manual',
          },
          {
            name: 'Sườn nướng',
            servingSize: '1 miếng (120g)',
            quantity: 1,
            calories: 280,
            protein: 24,
            carb: 6,
            fat: 16,
            source: 'manual',
          },
          {
            name: 'Chả trứng & Bì',
            servingSize: '1 phần',
            quantity: 1,
            calories: 120,
            protein: 6,
            carb: 18,
            fat: 4,
            source: 'manual',
          },
        ],
      },
    },
  });

  // Bữa Phụ: Sữa chua Hy Lạp & Hạt dinh dưỡng
  const snack = await prisma.meal.create({
    data: {
      userId: testUser.id,
      mealType: MealType.SNACK,
      date: new Date(),
      totalCalories: 190,
      totalProtein: 14,
      totalCarb: 18,
      totalFat: 6,
      items: {
        create: [
          {
            name: 'Sữa chua Hy Lạp không đường',
            servingSize: '100g',
            quantity: 1,
            calories: 110,
            protein: 10,
            carb: 8,
            fat: 4,
            source: 'manual',
          },
          {
            name: 'Hạt hạnh nhân & việt quất',
            servingSize: '30g',
            quantity: 1,
            calories: 80,
            protein: 4,
            carb: 10,
            fat: 2,
            source: 'manual',
          },
        ],
      },
    },
  });

  console.log('✅ Đã tạo 3 bữa ăn mẫu (Sáng, Trưa, Phụ) hôm nay cho testuser');

  // 4. Tạo lịch sử cân nặng (Weight Logs)
  await prisma.weightLog.deleteMany({
    where: { userId: testUser.id },
  });

  const day1 = new Date();
  day1.setDate(day1.getDate() - 14);
  const day2 = new Date();
  day2.setDate(day2.getDate() - 7);
  const day3 = new Date();

  await prisma.weightLog.createMany({
    data: [
      { userId: testUser.id, weightKg: 72.0, note: 'Bắt đầu lộ trình', date: day1 },
      { userId: testUser.id, weightKg: 71.1, note: 'Tuần 1 cảm thấy nhẹ người', date: day2 },
      { userId: testUser.id, weightKg: 70.0, note: 'Mục tiêu tuần 2 đạt chuẩn', date: day3 },
    ],
  });
  console.log('✅ Đã tạo lịch sử cân nặng 3 mốc (72kg -> 71.1kg -> 70kg)');

  // 5. Tạo danh sách món ăn yêu thích (Favorite Foods)
  await prisma.favoriteFood.deleteMany({
    where: { userId: testUser.id },
  });

  await prisma.favoriteFood.createMany({
    data: [
      { userId: testUser.id, foodName: 'Phở Bò Tái Nạm' },
      { userId: testUser.id, foodName: 'Cơm Tấm Sườn Bì Chả' },
      { userId: testUser.id, foodName: 'Ức Gà Áp Chảo' },
      { userId: testUser.id, foodName: 'Trứng Luộc' },
    ],
  });
  console.log('✅ Đã tạo danh sách món ăn yêu thích mẫu');

  console.log('\n🎉 KHỞI TẠO HOÀN TẤT DỮ LIỆU SEED! 🎉');
  console.log('----------------------------------------------------');
  console.log('👉 Tài khoản người dùng mẫu:');
  console.log('   Username: testuser');
  console.log('   Password: User@123456');
  console.log('👉 Tài khoản Quản trị:');
  console.log('   Username: admin');
  console.log('   Password: admin');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed dữ liệu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
