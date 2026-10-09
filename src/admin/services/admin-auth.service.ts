import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminAuditService } from './admin-audit.service';
import { Role } from '@prisma/client';

interface LoginAttempt {
  count: number;
  lockedUntil?: Date;
}

@Injectable()
export class AdminAuthService {
  // Bộ nhớ theo dõi số lần đăng nhập sai (BR-17.1: tối đa 5 lần trong 15 phút)
  private readonly attempts = new Map<string, LoginAttempt>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AdminAuditService,
  ) {}

  async login(
    dto: AdminLoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const emailKey = dto.email.toLowerCase().trim();
    const now = new Date();

    // 1. Kiểm tra trạng thái khoá tạm
    const attempt = this.attempts.get(emailKey);
    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
      const waitMin = Math.ceil(
        (attempt.lockedUntil.getTime() - now.getTime()) / 60000,
      );
      throw new ForbiddenException(
        `Tài khoản bị khoá tạm do nhập sai quá 5 lần. Vui lòng thử lại sau ${waitMin} phút.`,
      );
    }

    // 2. Tìm user
    const user = await this.prisma.user.findUnique({
      where: { email: emailKey },
    });

    if (!user || !user.password) {
      this.recordFailedAttempt(emailKey);
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    // 3. Kiểm tra vai trò ADMIN (BR-17.1: USER bị từ chối 403)
    if (user.role !== Role.ADMIN) {
      this.recordFailedAttempt(emailKey);
      throw new ForbiddenException(
        'Tài khoản của bạn không có quyền truy cập vào bảng điều khiển quản trị',
      );
    }

    // 4. Kiểm tra mật khẩu
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      this.recordFailedAttempt(emailKey);
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    // Đăng nhập thành công -> Xoá đếm sai
    this.attempts.delete(emailKey);

    // 5. Cấp access token (15m) & refresh token (8h)
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      isAdmin: true,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '8h',
    });

    // 6. Ghi Audit Log
    await this.auditService.logAction({
      adminId: user.id,
      adminEmail: user.email || undefined,
      action: 'LOGIN',
      targetType: 'AdminAuth',
      targetId: user.id,
      reason: 'Đăng nhập thành công vào hệ thống quản trị',
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'Đăng nhập quản trị thành công',
      data: {
        accessToken,
        refreshToken,
        admin: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    };
  }

  private recordFailedAttempt(emailKey: string) {
    const cur = this.attempts.get(emailKey) ?? { count: 0 };
    cur.count += 1;
    if (cur.count >= 5) {
      const lock = new Date();
      lock.setMinutes(lock.getMinutes() + 15);
      cur.lockedUntil = lock;
    }
    this.attempts.set(emailKey, cur);
  }

  async getMe(adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user || user.role !== Role.ADMIN) {
      throw new ForbiddenException('Không tìm thấy tài khoản quản trị');
    }

    return {
      message: 'Lấy thông tin quản trị viên thành công',
      data: user,
    };
  }
}
