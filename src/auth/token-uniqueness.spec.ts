import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService, hashRefreshToken } from './auth.service';

/**
 * Hai token của cùng một người tạo trong cùng một giây trước đây là chuỗi GIỐNG HỆT NHAU (cùng payload, cùng iat).
 * Khi đó xoay vòng refresh token không phân biệt được token cũ với token mới, đăng xuất có thể thu hồi nhầm phiên
 * trùng chuỗi, và phát hiện đánh cắp hoạt động thất thường.
 */
describe('Token đăng nhập luôn duy nhất', () => {
  const jwt = new JwtService();
  const config: any = {
    get: (key: string) =>
      ({
        JWT_ACCESS_SECRET: 'a-secret',
        JWT_REFRESH_SECRET: 'r-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      })[key],
  };
  const service: any = Object.create(AuthService.prototype);
  service.jwtService = jwt;
  service.configService = config;

  it('tạo liên tiếp nhiều lần trong cùng giây vẫn cho các refresh token và access token khác nhau', async () => {
    const batch = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.generateTokens('u1', 'an', 'USER'),
      ),
    );
    expect(new Set(batch.map((t: any) => t.refreshToken)).size).toBe(20);
    expect(new Set(batch.map((t: any) => t.accessToken)).size).toBe(20);
  });

  it('token vẫn giải mã được và mang đủ thông tin cũ cộng thêm jti', async () => {
    const { accessToken, refreshToken } = await service.generateTokens(
      'u1',
      'an',
      'USER',
    );
    const a = jwt.verify(accessToken, { secret: 'a-secret' });
    const r = jwt.verify(refreshToken, { secret: 'r-secret' });
    expect(a).toMatchObject({ sub: 'u1', username: 'an', role: 'USER' });
    expect(r).toMatchObject({ sub: 'u1', username: 'an', role: 'USER' });
    expect(typeof a.jti).toBe('string');
    expect(typeof r.jti).toBe('string');
    expect(a.jti).not.toBe(r.jti);
  });

  it('refresh token chỉ giải mã được bằng khoá refresh, không bằng khoá access', async () => {
    const { refreshToken } = await service.generateTokens('u1', 'an', 'USER');
    expect(() => jwt.verify(refreshToken, { secret: 'a-secret' })).toThrow();
  });

  it('băm token phân biệt được hai token của cùng một người (bcrypt thì KHÔNG: chỉ xét 72 byte đầu)', async () => {
    const a = (await service.generateTokens('u1', 'an', 'USER')).refreshToken;
    const b = (await service.generateTokens('u1', 'an', 'USER')).refreshToken;
    expect(a).not.toBe(b);

    // Chứng minh lỗi cũ: bcrypt coi token b là token a
    const bcryptHash = await bcrypt.hash(a, 4);
    expect(await bcrypt.compare(b, bcryptHash)).toBe(true);

    // Cách mới phân biệt đúng, và cùng một token luôn cho cùng một hash
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
