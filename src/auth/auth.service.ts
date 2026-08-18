import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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

    return {
      message: 'Đăng ký tài khoản thành công',
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
   * Đăng nhập hệ thống bằng tên đăng nhập (username) hoặc email
   */
  async login(loginDto: LoginDto) {
    const { username, password } = loginDto;
    const identifier = username.trim().toLowerCase();

    // 1. Tìm user theo username hoặc email
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
        ],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // 2. Kiểm tra tài khoản có bị khóa không
    if (!user.isActive) {
      throw new ForbiddenException('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.');
    }

    // 3. Đối chiếu mật khẩu
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không chính xác');
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
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret',
      });
    } catch (e) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }

    // 2. Tìm user
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.refreshTokenHash || !user.isActive) {
      throw new UnauthorizedException('Không thể cấp mới token. Vui lòng đăng nhập lại.');
    }

    // 3. Đối chiếu refreshToken gửi lên với hash lưu trong DB
    const isTokenMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isTokenMatch) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    // 4. Sinh bộ tokens mới
    const newTokens = await this.generateTokens(user.id, user.username, user.role);
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
   * Sinh Access Token và Refresh Token
   */
  private async generateTokens(userId: string, username: string, role: string) {
    const payload = { sub: userId, username, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') || 'default_access_secret',
        expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'default_refresh_secret',
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
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
