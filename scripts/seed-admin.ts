import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12;

/** Mật khẩu ngẫu nhiên mạnh, dùng khi không đặt ADMIN_PASSWORD. Chỉ hiển thị một lần ở màn hình. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main() {
  // Bắt buộc khai báo email quản trị: không có tài khoản/mật khẩu mặc định ai cũng đoán được.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    console.error(
      '[Seed Admin] Thiếu ADMIN_EMAIL. Ví dụ: ADMIN_EMAIL=ban@congty.vn ADMIN_PASSWORD="..." npm run seed:admin',
    );
    process.exit(1);
  }

  const providedPassword = process.env.ADMIN_PASSWORD;
  if (providedPassword && providedPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `[Seed Admin] ADMIN_PASSWORD phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
    );
    process.exit(1);
  }
  const adminPassword = providedPassword ?? generatePassword();

  console.log(
    `[Seed Admin] Đang kiểm tra tài khoản quản trị (${adminEmail})...`,
  );

  // Chỉ tìm theo EMAIL. Không tìm theo username "admin": ai cũng đăng ký được username này, nếu seed tự
  // nâng quyền tài khoản đó thành ADMIN thì kẻ đăng ký trước (còn giữ email của họ để đặt lại mật khẩu)
  // sẽ chiếm được quyền quản trị.
  const existingUser = await prisma.user.findFirst({
    where: { email: adminEmail },
  });

  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  if (existingUser) {
    const updated = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        role: Role.ADMIN,
        isEmailVerified: true,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
        password: hashedPassword,
        refreshTokenHash: null, // thu hồi phiên cũ khi đặt lại mật khẩu quản trị
        name: existingUser.name || 'System Administrator',
      },
    });
    await prisma.refreshSession
      .updateMany({
        where: { userId: updated.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);

    console.log(`[Seed Admin] Cập nhật tài khoản Admin thành công:`);
    console.log(`- ID: ${updated.id}`);
    console.log(`- Email: ${updated.email}`);
    console.log(`- Role: ${updated.role}`);
  } else {
    // Username "admin" có thể đã bị người khác dùng: đổi sang tên khác thay vì chiếm tài khoản đó.
    const taken = await prisma.user.findFirst({ where: { username: 'admin' } });
    const username = taken
      ? `admin-${randomBytes(3).toString('hex')}`
      : 'admin';

    const created = await prisma.user.create({
      data: {
        email: adminEmail,
        username,
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
  }

  if (!providedPassword) {
    console.log(
      `- Mật khẩu được tạo ngẫu nhiên (CHỈ HIỂN THỊ MỘT LẦN, hãy lưu lại): ${adminPassword}`,
    );
  } else {
    console.log('- Mật khẩu: lấy từ ADMIN_PASSWORD (không hiển thị).');
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
