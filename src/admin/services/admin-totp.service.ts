import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateSecret,
  hashBackupCode,
  otpauthUrl,
  verifyTotp,
} from '../totp';

/** Xác thực hai lớp TOTP cho tài khoản ADMIN (BR-17.5). Bí mật mã hoá AES-256-GCM khi lưu. */
@Injectable()
export class AdminTotpService {
  private readonly logger = new Logger(AdminTotpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly config: ConfigService,
  ) {}

  /** Khoá mã hoá: ADMIN_TOTP_ENC_KEY nếu có; không thì dẫn xuất từ JWT_ACCESS_SECRET (nên đặt khoá riêng khi phát hành). */
  private keyMaterial(): string {
    const dedicated = this.config.get<string>('ADMIN_TOTP_ENC_KEY');
    if (dedicated) return dedicated;
    this.logger.warn('Chưa đặt ADMIN_TOTP_ENC_KEY, dùng khoá dẫn xuất từ JWT_ACCESS_SECRET');
    return `totp:${this.config.get<string>('JWT_ACCESS_SECRET') || 'default_jwt_secret'}`;
  }

  async status(adminId: string) {
    const row = await this.prisma.adminTotp.findUnique({ where: { userId: adminId } });
    return {
      message: 'Trạng thái xác thực hai lớp',
      data: { enabled: !!row?.enabled, backupCodesLeft: row?.enabled ? row.backupCodeHashes.length : 0 },
    };
  }

  /** Bắt đầu đăng ký: tạo bí mật mới (chưa bật). Gọi lại sẽ thay bí mật chưa xác nhận. */
  async setup(adminId: string, email: string) {
    const existing = await this.prisma.adminTotp.findUnique({ where: { userId: adminId } });
    if (existing?.enabled) throw new BadRequestException('Đã bật xác thực hai lớp. Hãy tắt trước khi đăng ký lại.');
    const secret = generateSecret();
    const secretEnc = encryptSecret(secret, this.keyMaterial());
    await this.prisma.adminTotp.upsert({
      where: { userId: adminId },
      update: { secretEnc, enabled: false, backupCodeHashes: [], lastUsedStep: null },
      create: { userId: adminId, secretEnc, enabled: false, backupCodeHashes: [] },
    });
    return {
      message: 'Quét mã QR bằng ứng dụng xác thực rồi nhập mã 6 số để bật',
      data: { secret, otpauthUrl: otpauthUrl(secret, email) },
    };
  }

  /** Xác nhận mã đầu tiên để bật; trả mã dự phòng MỘT LẦN DUY NHẤT. */
  async enable(adminId: string, code: string) {
    const row = await this.prisma.adminTotp.findUnique({ where: { userId: adminId } });
    if (!row) throw new BadRequestException('Chưa bắt đầu đăng ký xác thực hai lớp');
    if (row.enabled) throw new BadRequestException('Xác thực hai lớp đã được bật');
    const secret = decryptSecret(row.secretEnc, this.keyMaterial());
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException('Mã xác thực không đúng hoặc đã hết hạn');
    const codes = generateBackupCodes();
    await this.prisma.adminTotp.update({
      where: { userId: adminId },
      data: { enabled: true, enabledAt: new Date(), lastUsedStep: step, backupCodeHashes: codes.map(hashBackupCode) },
    });
    await this.audit.logAction({ adminId, action: 'TOTP_ENABLE', targetType: 'AdminAuth', targetId: adminId });
    return { message: 'Đã bật xác thực hai lớp. Hãy lưu các mã dự phòng ở nơi an toàn.', data: { backupCodes: codes } };
  }

  /** Tắt: cần mật khẩu và một mã hợp lệ (TOTP hoặc dự phòng). */
  async disable(adminId: string, password: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: adminId }, select: { password: true } });
    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      throw new ForbiddenException('Mật khẩu không đúng');
    }
    if (!(await this.verifyLogin(adminId, code))) throw new ForbiddenException('Mã xác thực không đúng');
    await this.prisma.adminTotp.delete({ where: { userId: adminId } });
    await this.audit.logAction({ adminId, action: 'TOTP_DISABLE', targetType: 'AdminAuth', targetId: adminId });
    return { message: 'Đã tắt xác thực hai lớp' };
  }

  /** Tài khoản này có bắt buộc mã khi đăng nhập không. */
  async isRequired(userId: string): Promise<boolean> {
    const row = await this.prisma.adminTotp.findUnique({ where: { userId }, select: { enabled: true } });
    return !!row?.enabled;
  }

  /**
   * Kiểm tra mã khi đăng nhập: TOTP (mỗi mã chỉ dùng một lần) hoặc mã dự phòng (dùng xong bị xoá).
   * Trả true nếu hợp lệ.
   */
  async verifyLogin(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.adminTotp.findUnique({ where: { userId } });
    if (!row?.enabled || !code) return false;
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const step = verifyTotp(decryptSecret(row.secretEnc, this.keyMaterial()), trimmed, Date.now(), row.lastUsedStep);
      if (step === null) return false;
      // Cập nhật có điều kiện: hai request cùng mã chỉ một cái thắng
      const res = await this.prisma.adminTotp.updateMany({
        where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
        data: { lastUsedStep: step },
      });
      return res.count > 0;
    }
    const hash = hashBackupCode(trimmed);
    if (!row.backupCodeHashes.includes(hash)) return false;
    const res = await this.prisma.adminTotp.updateMany({
      where: { userId, backupCodeHashes: { has: hash } },
      data: { backupCodeHashes: row.backupCodeHashes.filter((h) => h !== hash) },
    });
    return res.count > 0;
  }

  /** Dùng khi cần ném lỗi chuẩn cho đăng nhập thiếu/sai mã. */
  requiredError() {
    return new UnauthorizedException({ message: 'Cần mã xác thực hai lớp', code: 'TOTP_REQUIRED' });
  }
}
