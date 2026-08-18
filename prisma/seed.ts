import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Đang khởi tạo dữ liệu mẫu (Seeding)...');

  // 1. Tạo tài khoản Admin mặc định (username: admin, password: admin)
  const adminUsername = 'admin';
  const adminEmail = 'admin@calai.com';
  const adminPassword = 'admin'; // Mật khẩu admin mặc định

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [{ username: adminUsername }, { email: adminEmail }],
    },
  });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    const admin = await prisma.user.create({
      data: {
        username: adminUsername,
        email: adminEmail,
        password: hashedPassword,
        name: 'CalAI Admin',
        role: Role.ADMIN,
        dailyAiQuota: 999999, // Không giới hạn cho Admin
      },
    });

    console.log(`✅ Đã tạo tài khoản Admin thành công:`);
    console.log(`   - Username: ${admin.username}`);
    console.log(`   - Email: ${admin.email}`);
    console.log(`   - Password: ${adminPassword}`);
    console.log(`   - Role: ${admin.role}`);
  } else {
    console.log(`ℹ️ Tài khoản Admin (${adminUsername}) đã tồn tại.`);
  }

  // 2. Tạo một tài khoản User test mẫu (username: testuser, password: User@123456)
  const testUsername = 'testuser';
  const testUserEmail = 'user@calai.com';
  const testUserPassword = 'User@123456';

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: testUsername }, { email: testUserEmail }],
    },
  });

  if (!existingUser) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(testUserPassword, salt);

    await prisma.user.create({
      data: {
        username: testUsername,
        email: testUserEmail,
        password: hashedPassword,
        name: 'Test User',
        role: Role.USER,
        heightCm: 175,
        weightKg: 70,
        gender: 'MALE',
        goal: 'MAINTAIN',
        activityLevel: 'MODERATELY_ACTIVE',
        dailyAiQuota: 20,
      },
    });
    console.log(`✅ Đã tạo tài khoản User test mẫu:`);
    console.log(`   - Username: ${testUsername}`);
    console.log(`   - Password: ${testUserPassword}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed dữ liệu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
