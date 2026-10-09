import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly usedReauthTokens = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly billingService?: BillingService,
  ) {
    const googleClientId =
      this.configService.get<string>('GOOGLE_CLIENT_ID') || 'test-client-id';
    this.googleClient = new OAuth2Client(googleClientId);
  }

  /**
   * Đăng ký tài khoản người dùng mới (bằng username)
   */
  async register(registerDto: RegisterDto, deviceName?: string) {
    const { username, email, password, name } = registerDto;
    const cleanUsername = username.trim().toLowerCase();

    // 1. Kiểm tra username đã tồn tại chưa
    const existingUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername },
    });

    if (existingUser) {
      throw new ConflictException('Tên đăng nhập này đã được sử dụng');
    }

    // 2. Nếu có email, kiểm tra trùng email
    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (existingEmail) {
        throw new ConflictException('Email này đã được sử dụng');
      }
    }

    // 3. Hash mật khẩu (Bcrypt với Salt rounds = 10)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Tạo User trong Database
    const user = await this.prisma.user.create({
      data: {
        username: cleanUsername,
        email: email ? email.toLowerCase() : null,
        password: hashedPassword,
        name: name || cleanUsername,
      },
    });

    // 5. Sinh cặp tokens
    const tokens = await this.generateTokens(user.id, user.username, user.role);

    // 6. Lưu session và hashed refresh token vào DB (BR-01.3)
    await this.recordSession(user.id, tokens.refreshToken, deviceName);

    // 7. Nếu có email, gửi mã xác thực (không chặn luồng đăng ký nếu gửi lỗi)
    if (user.email) {
      this.sendVerificationEmail(user.id).catch((err) =>
        this.logger.error(
          `Gửi email xác thực thất bại cho user ${user.id}: ${err.message}`,
        ),
      );
    }

    return {
      message: 'Đăng ký tài khoản thành công',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
        ...tokens,
      },
    };
  }

  /**
   * Sinh mã OTP 6 số, lưu vào DB kèm hạn 15 phút, và gửi email xác thực
   */
  async sendVerificationEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }
    if (!user.email) {
      throw new BadRequestException(
        'Tài khoản chưa có địa chỉ email để xác thực',
      );
    }
    if (user.isEmailVerified) {
      throw new ConflictException('Email này đã được xác thực');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationCode: code,
        emailVerificationExpiresAt: expiresAt,
      },
    });

    await this.mailService.sendVerificationCode(user.email, code);

    return { message: 'Mã xác thực đã được gửi tới email của bạn' };
  }

  /**
   * Xác thực email bằng mã OTP đã gửi
   */
  async verifyEmail(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }
    if (user.isEmailVerified) {
      throw new ConflictException('Email này đã được xác thực');
    }
    if (!user.emailVerificationCode || !user.emailVerificationExpiresAt) {
      throw new BadRequestException(
        'Chưa có mã xác thực nào được gửi. Vui lòng yêu cầu gửi lại.',
      );
    }
    if (user.emailVerificationExpiresAt < new Date()) {
      throw new BadRequestException(
        'Mã xác thực đã hết hạn. Vui lòng yêu cầu gửi lại.',
      );
    }
    if (user.emailVerificationCode !== code) {
      throw new BadRequestException('Mã xác thực không chính xác');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationCode: null,
        emailVerificationExpiresAt: null,
      },
    });

    return { message: 'Xác thực email thành công' };
  }

  /**
   * Đăng nhập/Đăng ký bằng Google Sign-In (idToken xác thực qua Credential Manager phía Android)
   */
  async loginWithGoogle(idToken: string, deviceName?: string) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Server chưa cấu hình GOOGLE_CLIENT_ID');
    }

    let payload: any;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (e) {
      throw new UnauthorizedException(
        'idToken Google không hợp lệ hoặc đã hết hạn',
      );
    }

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException(
        'Không lấy được thông tin tài khoản Google',
      );
    }

    // BR-01.2: chỉ tin email mà Google xác nhận đã xác thực
    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Email của tài khoản Google chưa được xác thực',
      );
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { googleId } });

    if (!user) {
      // Chưa có tài khoản Google này — kiểm tra xem email đã tồn tại (đăng ký local trước đó) chưa
      user = await this.prisma.user.findUnique({ where: { email } });

      if (user) {
        // Email này đã gắn với một tài khoản Google khác
        if (user.googleId && user.googleId !== googleId) {
          throw new ConflictException(
            'Email này đã được liên kết với một tài khoản Google khác',
          );
        }

        const wasUnverified = !user.isEmailVerified;

        // Liên kết tài khoản local hiện có với Google. Nếu email CHƯA từng được xác thực thì
        // người đăng ký ban đầu có thể không phải chủ email: xoá mật khẩu và thu hồi phiên cũ.
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            isEmailVerified: true,
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
            ...(wasUnverified
              ? { password: null, refreshTokenHash: null }
              : {}),
          },
        });

        if (wasUnverified) {
          try {
            await this.mailService.sendGoogleLinkedNotice(email);
          } catch (e) {
            this.logger.warn(
              `Không gửi được email báo liên kết Google: ${(e as Error).message}`,
            );
          }
        }
      } else {
        const cleanUsername = await this.generateUniqueUsernameFromEmail(email);
        user = await this.prisma.user.create({
          data: {
            username: cleanUsername,
            email,
            password: null,
            name: payload.name || cleanUsername,
            avatar: payload.picture || null,
            authProvider: 'GOOGLE',
            googleId,
            isEmailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });
      }
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.',
      );
    }

    const tokens = await this.generateTokens(user.id, user.username, user.role);
    await this.recordSession(user.id, tokens.refreshToken, deviceName);

    return {
      message: 'Đăng nhập bằng Google thành công',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
        ...tokens,
      },
    };
  }

  /**
   * Sinh username duy nhất từ phần trước @ của email (thêm hậu tố số nếu trùng)
   */
  private async generateUniqueUsernameFromEmail(
    email: string,
  ): Promise<string> {
    const base =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 25) || 'user';

    let candidate = base;
    let suffix = 0;
    while (
      await this.prisma.user.findUnique({ where: { username: candidate } })
    ) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  /**
   * Đăng nhập hệ thống bằng tên đăng nhập (username) hoặc email
   */
  async login(loginDto: LoginDto, deviceName?: string) {
    const { username, password } = loginDto;
    const identifier = username.trim().toLowerCase();

    // 1. Tìm user theo username hoặc email
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Tên đăng nhập hoặc mật khẩu không chính xác',
      );
    }

    // 2. Kiểm tra tài khoản có bị khóa không
    if (!user.isActive) {
      throw new ForbiddenException(
        'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.',
      );
    }

    // 3. Đối chiếu mật khẩu (tài khoản đăng nhập bằng Google không có mật khẩu local)
    if (!user.password) {
      throw new UnauthorizedException(
        'Tài khoản này đăng nhập bằng Google. Vui lòng dùng Đăng nhập với Google.',
      );
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Tên đăng nhập hoặc mật khẩu không chính xác',
      );
    }

    // 4. Sinh cặp tokens
    const tokens = await this.generateTokens(user.id, user.username, user.role);

    // 5. Cập nhật hashed refresh token và tạo RefreshSession (BR-01.3)
    await this.recordSession(user.id, tokens.refreshToken, deviceName);

    return {
      message: 'Đăng nhập thành công',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        ...tokens,
      },
    };
  }

  /**
   * Cấp phát lại Access Token từ Refresh Token (Token Rotation & Multi-session BR-01.3)
   */
  async refreshTokens(refreshTokenDto: RefreshTokenDto, deviceName?: string) {
    const { refreshToken } = refreshTokenDto;

    // 1. Verify Refresh Token
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'default_refresh_secret',
      });
    } catch {
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    // 2. Tìm user
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Không thể cấp mới token. Vui lòng đăng nhập lại.',
      );
    }

    // 3. Tìm trong các RefreshSession của user (BR-01.3)
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let matchedSession: (typeof sessions)[0] | null = null;
    for (const s of sessions) {
      if (await bcrypt.compare(refreshToken, s.tokenHash)) {
        matchedSession = s;
        break;
      }
    }

    if (!matchedSession) {
      // Fallback kiểm tra legacy hash nếu có
      const legacyMatch = user.refreshTokenHash
        ? await bcrypt.compare(refreshToken, user.refreshTokenHash)
        : false;
      if (!legacyMatch) {
        throw new UnauthorizedException('Refresh token không hợp lệ');
      }
    }

    // Phát hiện token đã bị thay thế (Token Reuse / Token Theft)
    if (
      matchedSession &&
      (matchedSession.replacedBy || matchedSession.revokedAt)
    ) {
      const elapsed = Date.now() - matchedSession.lastUsedAt.getTime();
      // Dung sai 10 giây cho trường hợp gửi trùng do mạng chập chờn
      if (elapsed > 10_000) {
        // Thu hồi toàn bộ phiên của user và ngắt kết nối ngay lập tức
        await this.prisma.refreshSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.prisma.user.update({
          where: { id: user.id },
          data: { refreshTokenHash: null },
        });
        throw new UnauthorizedException({
          code: 'SESSION_REVOKED',
          message: 'Phiên làm việc đã bị thu hồi do phát hiện bất thường',
        });
      }
    }

    // 4. Sinh bộ tokens mới
    const newTokens = await this.generateTokens(
      user.id,
      user.username,
      user.role,
    );

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newTokens.refreshToken, salt);
    const now = new Date();

    // Tạo phiên mới và liên kết replacedBy
    const newSession = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        deviceName:
          matchedSession?.deviceName || deviceName || 'Thiết bị không xác định',
      },
    });

    if (matchedSession && !matchedSession.replacedBy) {
      await this.prisma.refreshSession.update({
        where: { id: matchedSession.id },
        data: {
          replacedBy: newSession.id,
          revokedAt: now,
          lastUsedAt: now,
        },
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: newHash },
    });

    return {
      message: 'Làm mới token thành công',
      data: newTokens,
    };
  }

  /**
   * Đăng xuất phiên hiện tại
   */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const sessions = await this.prisma.refreshSession.findMany({
        where: { userId, revokedAt: null },
      });
      for (const s of sessions) {
        if (await bcrypt.compare(refreshToken, s.tokenHash)) {
          await this.prisma.refreshSession.update({
            where: { id: s.id },
            data: { revokedAt: new Date() },
          });
          break;
        }
      }
    } else {
      const latest = await this.prisma.refreshSession.findFirst({
        where: { userId, revokedAt: null },
        orderBy: { lastUsedAt: 'desc' },
      });
      if (latest) {
        await this.prisma.refreshSession.update({
          where: { id: latest.id },
          data: { revokedAt: new Date() },
        });
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    return {
      message: 'Đăng xuất thành công',
    };
  }

  /**
   * Đăng xuất khỏi toàn bộ thiết bị (BR-01.3)
   */
  async logoutAll(userId: string) {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    return {
      message: 'Đã đăng xuất khỏi tất cả thiết bị',
    };
  }

  /**
   * Danh sách thiết bị đăng nhập của người dùng (BR-01.3)
   */
  async getSessions(userId: string) {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return sessions;
  }

  /**
   * Thu hồi phiên đăng nhập cụ thể theo ID (BR-01.3)
   */
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new BadRequestException('Phiên đăng nhập không tồn tại');
    }
    await this.prisma.refreshSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { message: 'Đã thu hồi phiên đăng nhập thành công' };
  }

  /**
   * Đổi mật khẩu tài khoản
   */
  async changePassword(userId: string, changePasswordDto: any) {
    const { oldPassword, newPassword } = changePasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }
    if (!user.password) {
      throw new ConflictException(
        'Tài khoản này đăng nhập bằng Google, không có mật khẩu để đổi',
      );
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      throw new ConflictException('Mật khẩu hiện tại không chính xác');
    }

    if (oldPassword === newPassword) {
      throw new ConflictException(
        'Mật khẩu mới không được trùng với mật khẩu cũ',
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        refreshTokenHash: null,
      },
    });

    // Thu hồi toàn bộ phiên đăng nhập khi đổi mật khẩu (BR-01.3)
    await this.logoutAll(userId);

    return {
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
    };
  }

  /**
   * Yêu cầu đặt lại mật khẩu — gửi mã OTP tới email nếu tài khoản tồn tại.
   */
  async forgotPassword(email: string) {
    const cleanEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    const genericResponse = {
      message:
        'Nếu email tồn tại trong hệ thống, mã đặt lại mật khẩu đã được gửi tới',
    };

    if (!user || !user.password) {
      return genericResponse;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCode: code,
        passwordResetExpiresAt: expiresAt,
      },
    });

    await this.mailService.sendPasswordResetCode(cleanEmail, code);

    return genericResponse;
  }

  /**
   * Đặt lại mật khẩu bằng mã OTP đã gửi qua forgotPassword
   */
  async resetPassword(email: string, code: string, newPassword: string) {
    const cleanEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user) {
      throw new BadRequestException('Mã đặt lại mật khẩu không hợp lệ');
    }
    if (!user.passwordResetCode || !user.passwordResetExpiresAt) {
      throw new BadRequestException(
        'Chưa có yêu cầu đặt lại mật khẩu nào. Vui lòng yêu cầu lại.',
      );
    }
    if (user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException(
        'Mã đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu lại.',
      );
    }
    if (user.passwordResetCode !== code) {
      throw new BadRequestException('Mã đặt lại mật khẩu không chính xác');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetCode: null,
        passwordResetExpiresAt: null,
        refreshTokenHash: null,
      },
    });

    // Thu hồi tất cả phiên khi reset mật khẩu (BR-01.3)
    await this.logoutAll(user.id);

    return {
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.',
    };
  }

  /**
   * Xác thực lại bằng mật khẩu trước thao tác nhạy cảm (BR-01.4)
   * Trả về reauthToken có hiệu lực 5 phút
   */
  async reauth(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }
    if (!user.password) {
      throw new BadRequestException(
        'Tài khoản đăng nhập bằng Google. Vui lòng xác thực lại bằng Google.',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Mật khẩu không chính xác');
    }

    const token = this.jwtService.sign(
      { sub: user.id, type: 'REAUTH' },
      {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          'default_access_secret',
        expiresIn: '5m',
      },
    );

    return {
      reauthToken: token,
      expiresInSec: 300,
    };
  }

  /**
   * Xác thực lại bằng Google idToken trước thao tác nhạy cảm (BR-01.4)
   */
  async reauthGoogle(userId: string, idToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }

    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    let payload: any;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'idToken Google không hợp lệ hoặc đã hết hạn',
      );
    }

    if (
      payload?.email_verified !== true ||
      payload?.email?.toLowerCase() !== user.email?.toLowerCase()
    ) {
      throw new UnauthorizedException('Xác thực tài khoản Google không khớp');
    }

    const token = this.jwtService.sign(
      { sub: user.id, type: 'REAUTH' },
      {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          'default_access_secret',
        expiresIn: '5m',
      },
    );

    return {
      reauthToken: token,
      expiresInSec: 300,
    };
  }

  /**
   * Xóa vĩnh viễn tài khoản người dùng và toàn bộ dữ liệu (BR-01.4)
   * Yêu cầu reauthToken còn hiệu lực và dùng 1 lần.
   * Dữ liệu liên quan bị xoá dây chuyền (Cascade); BillingEvent được ẩn danh (userId = null).
   */
  async deleteAccount(userId: string, reauthToken?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }

    if (!reauthToken) {
      throw new UnauthorizedException({
        code: 'REAUTH_REQUIRED',
        message: 'Cần xác thực lại mật khẩu/Google trước khi xóa tài khoản.',
      });
    }

    if (this.usedReauthTokens.has(reauthToken)) {
      throw new UnauthorizedException({
        code: 'REAUTH_REQUIRED',
        message: 'Mã xác thực lại đã được sử dụng.',
      });
    }

    try {
      const payload = this.jwtService.verify(reauthToken, {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          'default_access_secret',
      });
      if (payload?.type !== 'REAUTH' || payload?.sub !== userId) {
        throw new UnauthorizedException({
          code: 'REAUTH_REQUIRED',
          message: 'Mã xác thực lại không hợp lệ.',
        });
      }
    } catch {
      throw new UnauthorizedException({
        code: 'REAUTH_REQUIRED',
        message: 'Mã xác thực lại không hợp lệ hoặc đã hết hạn (quá 5 phút).',
      });
    }

    this.usedReauthTokens.add(reauthToken);

    // 1. Ẩn danh BillingEvent (BR-01.4: giữ dữ liệu thanh toán ẩn danh theo quy định kế toán)
    await this.prisma.billingEvent.updateMany({
      where: { userId },
      data: { userId: null },
    });

    // 2. Huỷ các đơn QR đang PENDING (nếu có)
    await this.prisma.paymentOrder.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'CANCELED' },
    });

    // 3. Xóa user — schema quan hệ onDelete: Cascade sẽ tự xoá sạch toàn bộ dữ liệu con
    await this.prisma.user.delete({
      where: { id: userId },
    });

    // 4. Xóa cache quyền hạn
    this.billingService?.invalidate(userId);

    return {
      message: 'Tài khoản và toàn bộ dữ liệu liên quan đã được xóa vĩnh viễn',
    };
  }

  /**
   * Chính sách Quyền riêng tư (BR-18)
   */
  getPrivacyPolicy() {
    return {
      title: 'Chính sách Quyền riêng tư NutriWise',
      version: '1.0.0',
      lastUpdated: '2026-10-09',
      summary:
        'NutriWise cam kết bảo vệ dữ liệu sức khỏe và thông tin cá nhân của bạn.',
      sections: [
        {
          heading: '1. Dữ liệu thu thập',
          content:
            'NutriWise thu thập các thông tin thể chất (tuổi, giới tính, chiều cao, cân nặng, tỷ lệ mỡ), nhật ký ăn uống và hình ảnh món ăn, dữ liệu tập luyện, nhật ký nước và giấc ngủ nhằm phục vụ mục đích tính toán dinh dưỡng.',
        },
        {
          heading: '2. Mục đích sử dụng',
          content:
            'Dữ liệu được dùng để tính toán năng lượng tiêu hao thích ứng (Adaptive Expenditure Engine), gợi ý thực đơn an toàn và theo dõi tiến độ sức khỏe.',
        },
        {
          heading: '3. Chia sẻ dữ liệu với bên thứ ba',
          content:
            'Hình ảnh món ăn và câu hỏi dinh dưỡng được xử lý bảo mật qua Google Gemini AI (không kèm danh tính cá nhân). Thanh toán Premium được xử lý qua Google Play Store hoặc cổng ngân hàng VietQR/SePay.',
        },
        {
          heading: '4. Quyền của người dùng',
          content:
            'Bạn có quyền xem, chỉnh sửa thông tin, xuất toàn bộ dữ liệu cá nhân ra file ZIP (POST /api/v1/me/export) hoặc xóa vĩnh viễn tài khoản bất kỳ lúc nào (DELETE /api/v1/auth/me).',
        },
      ],
    };
  }

  /**
   * Sinh Access Token và Refresh Token
   */
  private async generateTokens(userId: string, username: string, role: string) {
    const payload = { sub: userId, username, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          'default_access_secret',
        expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ||
          '15m') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'default_refresh_secret',
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
          '7d') as any,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Lưu phiên đăng nhập RefreshSession và hash vào DB (BR-01.3: tối đa 5 phiên)
   */
  private async recordSession(
    userId: string,
    refreshToken: string,
    deviceName?: string,
  ) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(refreshToken, salt);

    // Cập nhật legacy hash
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hash },
    });

    // Tạo bản ghi RefreshSession mới nếu model tồn tại
    if (this.prisma.refreshSession) {
      await this.prisma.refreshSession.create({
        data: {
          userId,
          tokenHash: hash,
          deviceName: deviceName || 'Thiết bị không xác định',
        },
      });

      // Giới hạn tối đa 5 phiên hoạt động: thu hồi phiên cũ nhất nếu >= 6
      const activeSessions = await this.prisma.refreshSession.findMany({
        where: { userId, revokedAt: null },
        orderBy: { lastUsedAt: 'desc' },
      });

      if (activeSessions.length > 5) {
        const excess = activeSessions.slice(5);
        await this.prisma.refreshSession.updateMany({
          where: { id: { in: excess.map((s) => s.id) } },
          data: { revokedAt: new Date() },
        });
      }
    }
  }

  /**
   * Lưu hash của Refresh Token vào DB (tương thích ngược)
   */
  private async updateRefreshTokenHash(userId: string, refreshToken: string) {
    await this.recordSession(userId, refreshToken);
  }
}
