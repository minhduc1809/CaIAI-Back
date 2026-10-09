import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';

describe('Nhóm A: Quyền dữ liệu, phiên thiết bị & Chính sách bảo mật', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: JwtService;
  let billing: any;

  const mockUser = {
    id: 'user-a1',
    username: 'testuser',
    email: 'test@example.com',
    password: '',
    role: 'USER',
    isActive: true,
    refreshTokenHash: null,
  };

  beforeAll(async () => {
    mockUser.password = await bcrypt.hash('Secret123!', 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }) => {
          if (
            where.id === 'user-a1' ||
            where.username === 'testuser' ||
            where.email === 'test@example.com'
          ) {
            return { ...mockUser };
          }
          return null;
        }),
        findFirst: jest.fn(async () => ({ ...mockUser })),
        create: jest.fn(async ({ data }) => ({ id: 'new-user', ...data })),
        update: jest.fn(async ({ data }) => ({ ...mockUser, ...data })),
        delete: jest.fn(async () => ({ ...mockUser })),
      },
      refreshSession: {
        create: jest.fn(async ({ data }) => ({
          id: 'sess-' + Math.random().toString(36).substring(7),
          ...data,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          revokedAt: null,
          replacedBy: null,
        })),
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }) => ({ ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      billingEvent: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      paymentOrder: {
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      $executeRawUnsafe: jest.fn(async () => 1),
    };

    billing = {
      invalidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn((payload) => 'jwt-token-' + JSON.stringify(payload)),
            signAsync: jest.fn(
              async (payload) => 'jwt-async-' + JSON.stringify(payload),
            ),
            verify: jest.fn((token) => {
              if (token.startsWith('jwt-token-')) {
                return JSON.parse(token.replace('jwt-token-', ''));
              }
              if (token === 'valid-refresh') return { sub: 'user-a1' };
              throw new Error('Invalid token');
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'JWT_ACCESS_SECRET') return 'secret';
              if (key === 'JWT_REFRESH_SECRET') return 'secret';
              return null;
            }),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationCode: jest.fn(),
            sendPasswordResetCode: jest.fn(),
          },
        },
        {
          provide: BillingService,
          useValue: billing,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwt = module.get<JwtService>(JwtService);
  });

  describe('A1. Xoá tài khoản đầy đủ (BR-01.4)', () => {
    it('reauth đúng mật khẩu trả về reauthToken', async () => {
      const result = await service.reauth('user-a1', 'Secret123!');
      expect(result.reauthToken).toBeDefined();
      expect(result.expiresInSec).toBe(300);
    });

    it('reauth sai mật khẩu bị từ chối 401', async () => {
      await expect(service.reauth('user-a1', 'WrongPassword')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('xoá tài khoản không có reauthToken bị từ chối 401 REAUTH_REQUIRED', async () => {
      await expect(service.deleteAccount('user-a1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('xoá tài khoản với reauthToken hợp lệ: ẩn danh BillingEvent, xoá cascade và huỷ cache', async () => {
      const { reauthToken } = await service.reauth('user-a1', 'Secret123!');

      const res = await service.deleteAccount('user-a1', reauthToken);
      expect(res.message).toContain('xóa vĩnh viễn');
      expect(prisma.billingEvent.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-a1' },
        data: { userId: null },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-a1' },
      });
      expect(billing.invalidate).toHaveBeenCalledWith('user-a1');
    });

    it('dùng lại reauthToken đã dùng lần 2 bị từ chối (single-use token)', async () => {
      const { reauthToken } = await service.reauth('user-a1', 'Secret123!');
      await service.deleteAccount('user-a1', reauthToken);

      // Thử dùng lại
      await expect(
        service.deleteAccount('user-a1', reauthToken),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('A2. Phiên đăng nhập nhiều thiết bị & Token Rotation (BR-01.3)', () => {
    it('đăng nhập tạo RefreshSession mới kèm deviceName', async () => {
      await service.login(
        { username: 'testuser', password: 'Secret123!' },
        'Pixel 8 Android',
      );

      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-a1',
            deviceName: 'Pixel 8 Android',
          }),
        }),
      );
    });

    it('phiên thứ 6 thu hồi phiên cũ nhất (giới hạn tối đa 5 phiên)', async () => {
      const oldSessions = Array.from({ length: 6 }).map((_, i) => ({
        id: `sess-${i}`,
        userId: 'user-a1',
        tokenHash: 'hash',
        lastUsedAt: new Date(Date.now() - (6 - i) * 10000),
      }));

      prisma.refreshSession.findMany.mockResolvedValueOnce(oldSessions);

      await service.login(
        { username: 'testuser', password: 'Secret123!' },
        'Device 6',
      );

      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['sess-5'] } },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('phát hiện tái sử dụng refresh token (Token Theft) thu hồi toàn bộ phiên của user', async () => {
      const token = 'stolen-refresh-token';
      const tokenHash = await bcrypt.hash(token, 10);

      // Session đã bị thay thế hơn 10 giây trước
      const compromisedSession = {
        id: 'sess-compromised',
        userId: 'user-a1',
        tokenHash,
        replacedBy: 'sess-new',
        revokedAt: new Date(Date.now() - 30_000),
        lastUsedAt: new Date(Date.now() - 30_000),
      };

      prisma.refreshSession.findMany.mockResolvedValueOnce([
        compromisedSession,
      ]);
      (jwt.verify as jest.Mock).mockReturnValueOnce({ sub: 'user-a1' });

      await expect(
        service.refreshTokens({ refreshToken: token }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SESSION_REVOKED' }),
      });

      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-a1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('đổi mật khẩu hoặc reset mật khẩu thu hồi tất cả phiên', async () => {
      await service.changePassword('user-a1', {
        oldPassword: 'Secret123!',
        newPassword: 'NewSecret456!',
      });

      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-a1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('logoutAll thu hồi tất cả các phiên', async () => {
      await service.logoutAll('user-a1');
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-a1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('A3. Chính sách quyền riêng tư (BR-18)', () => {
    it('trả về cấu trúc chính sách quyền riêng tư với các phần dữ liệu', () => {
      const policy = service.getPrivacyPolicy();
      expect(policy.title).toContain('NutriWise');
      expect(policy.sections.length).toBeGreaterThanOrEqual(4);
      expect(policy.sections.some((s) => s.content.includes('Gemini'))).toBe(
        true,
      );
      expect(policy.sections.some((s) => s.content.includes('export'))).toBe(
        true,
      );
    });
  });
});
