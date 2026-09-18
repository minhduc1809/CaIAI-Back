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
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  /**
   * Đăng ký tài khoản người dùng mới (bằng username)
   */
  async register(registerDto: RegisterDto) {
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

    // 6. Lưu hashed refresh token vào DB
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

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
  async loginWithGoogle(idToken: string) {
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

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { googleId } });

    if (!user) {
      // Chưa có tài khoản Google này — kiểm tra xem email đã tồn tại (đăng ký local trước đó) chưa
      user = await this.prisma.user.findUnique({ where: { email } });

      if (user) {
        // Liên kết tài khoản local hiện có với Google
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            isEmailVerified: true,
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
        });
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
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

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
  async login(loginDto: LoginDto) {
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

    // 5. Cập nhật hashed refresh token
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

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
   * Cấp phát lại Access Token từ Refresh Token (Token Rotation)
   */
  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    // 1. Verify Refresh Token
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'default_refresh_secret',
      });
    } catch (e) {
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    // 2. Tìm user
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.refreshTokenHash || !user.isActive) {
      throw new UnauthorizedException(
        'Không thể cấp mới token. Vui lòng đăng nhập lại.',
      );
    }

    // 3. Đối chiếu refreshToken gửi lên với hash lưu trong DB
    const isTokenMatch = await bcrypt.compare(
      refreshToken,
      user.refreshTokenHash,
    );
    if (!isTokenMatch) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    // 4. Sinh bộ tokens mới
    const newTokens = await this.generateTokens(
      user.id,
      user.username,
      user.role,
    );
    await this.updateRefreshTokenHash(user.id, newTokens.refreshToken);

    return {
      message: 'Làm mới token thành công',
      data: newTokens,
    };
  }

  /**
   * Đăng xuất (xóa refreshToken trong DB)
   */
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });

    return {
      message: 'Đăng xuất thành công',
    };
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

    return {
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
    };
  }

  /**
   * Yêu cầu đặt lại mật khẩu — gửi mã OTP tới email nếu tài khoản tồn tại.
   * Luôn trả về cùng 1 thông báo dù email có tồn tại hay không, tránh lộ thông tin
   * tài khoản nào đã đăng ký (user enumeration).
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
      // Không tiết lộ tài khoản không tồn tại, hoặc tài khoản chỉ đăng nhập bằng Google (không có mật khẩu để đặt lại)
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

    return {
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.',
    };
  }

  /**
   * Xóa vĩnh viễn tài khoản người dùng
   */
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: 'Tài khoản và toàn bộ dữ liệu liên quan đã được xóa vĩnh viễn',
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
   * Lưu hash của Refresh Token vào DB
   */
  private async updateRefreshTokenHash(userId: string, refreshToken: string) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(refreshToken, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hash },
    });
  }
}
