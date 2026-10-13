import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { MIN_REASON_LENGTH } from '../../system-config/system-config.service';

/**
 * Xác thực lại cho thao tác nhạy cảm (tiền, quyền Premium, khoá tài khoản, cấu hình an toàn). Backend là nơi quyết định cuối
 * cùng: ẩn nút hay hộp thoại ở frontend không phải cơ chế bảo mật.
 */
@Injectable()
export class AdminReauthService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyPassword(adminId: string, password?: string): Promise<void> {
    if (!password) throw new ForbiddenException({ code: 'REAUTH_REQUIRED', message: 'Cần nhập lại mật khẩu để xác nhận thao tác này' });
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { password: true } });
    const ok = !!admin?.password && (await bcrypt.compare(password, admin.password));
    if (!ok) throw new ForbiddenException({ code: 'REAUTH_FAILED', message: 'Mật khẩu xác nhận không đúng' });
  }

  requireReason(reason?: string): string {
    const r = (reason ?? '').trim();
    if (r.length < MIN_REASON_LENGTH) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: `Phải ghi lý do (ít nhất ${MIN_REASON_LENGTH} ký tự)` });
    }
    return r;
  }
}
