import { PrismaClient, Role, GoalType, WorkoutLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { VIETNAMESE_FOODS_DATA } from '../src/recommendations/data/vietnamese-food-database.data';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Đang khởi tạo dữ liệu mẫu (Seeding) cho CalAI Backend...');

  // 1. Tạo tài khoản Admin mặc định (username: admin, password: admin)
  const adminUsername = 'admin';
  const adminEmail = 'admin@calai.com';
  const adminPassword = 'admin';

  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ username: adminUsername }, { email: adminEmail }] },
  });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        password: hashedPassword,
        name: 'CalAI Admin',
        role: Role.ADMIN,
        dailyAiQuota: 999999,
      },
    });
    console.log(`✅ Đã tạo tài khoản Admin: admin / admin`);
  }

  // 2. Tạo tài khoản Test User (username: testuser, password: User@123456)
  const testUsername = 'testuser';
  const testUserEmail = 'user@calai.com';
  const testUserPassword = 'User@123456';

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ username: testUsername }, { email: testUserEmail }] },
  });

  if (!existingUser) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(testUserPassword, salt);

    await prisma.user.create({
      data: {
        username: testUsername,
        email: testUserEmail,
        password: hashedPassword,
        name: 'Nguyễn Văn Test',
        role: Role.USER,
        heightCm: 172,
        weightKg: 74,
        gender: 'MALE',
        goal: GoalType.LOSE_WEIGHT,
        activityLevel: 'LIGHTLY_ACTIVE',
        bmi: 25.0,
        bmr: 1675,
        tdee: 2303,
        targetCalories: 1800,
        targetProtein: 158,
        targetCarb: 180,
        targetFat: 50,
        dailyAiQuota: 20,
      },
    });
    console.log(`✅ Đã tạo tài khoản User test: testuser / User@123456`);
  }

  console.log(`✅ Đã khởi tạo hoàn tất dữ liệu mẫu!`);
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed dữ liệu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
