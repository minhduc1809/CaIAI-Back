import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nutriwise.vn';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const adminUsername = 'admin';

  console.log(
    `[Seed Admin] Đang kiểm tra tài khoản quản trị (${adminEmail})...`,
  );

  // Tìm user theo email hoặc username 'admin'
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: adminEmail }, { username: adminUsername }],
    },
  });

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(adminPassword, salt);

  if (existingUser) {
    const updated = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email: existingUser.email || adminEmail,
        role: Role.ADMIN,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        password: hashedPassword,
        name: existingUser.name || 'System Administrator',
      },
    });

    console.log(`[Seed Admin] Cập nhật tài khoản Admin thành công:`);
    console.log(`- ID: ${updated.id}`);
    console.log(`- Email: ${updated.email}`);
    console.log(`- Role: ${updated.role}`);
    console.log(`- Password đã cập nhật về: ${adminPassword}`);
  } else {
    const created = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        password: hashedPassword,
        name: 'System Administrator',
        role: Role.ADMIN,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    console.log(`[Seed Admin] Tạo mới tài khoản Admin thành công:`);
    console.log(`- ID: ${created.id}`);
    console.log(`- Email: ${created.email}`);
    console.log(`- Username: ${created.username}`);
    console.log(`- Role: ${created.role}`);
    console.log(`- Password mặc định: ${adminPassword}`);
  }
}

main()
  .catch((e) => {
    console.error('[Seed Admin] Lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
