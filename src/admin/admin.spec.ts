import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import {
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';

import { AdminAuthService } from './services/admin-auth.service';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminPaymentsService } from './services/admin-payments.service';
import { AdminBillingService } from './services/admin-billing.service';

describe('Admin Module - Giai đoạn 1: Nền tảng Xác thực, Vận hành Thanh toán & Người dùng (BR-17)', () => {
  let authService: AdminAuthService;
  let auditService: AdminAuditService;
  let dashboardService: AdminDashboardService;
  let usersService: AdminUsersService;
  let paymentsService: AdminPaymentsService;
  let billingAdminService: AdminBillingService;

  let prisma: any;
  let billingServiceMock: any;
  let paymentsServiceMock: any;
  let jwtServiceMock: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      paymentOrder: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      manualGrant: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscriptionState: {
        count: jest.fn(),
      },
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      billingEvent: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    billingServiceMock = {
      invalidate: jest.fn(),
    };

    paymentsServiceMock = {
      adminApprove: jest.fn(),
    };

    jwtServiceMock = {
      sign: jest.fn().mockReturnValue('mock_token_jwt'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        AdminAuditService,
        AdminDashboardService,
        AdminUsersService,
        AdminPaymentsService,
        AdminBillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: BillingService, useValue: billingServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    authService = module.get<AdminAuthService>(AdminAuthService);
    auditService = module.get<AdminAuditService>(AdminAuditService);
    dashboardService = module.get<AdminDashboardService>(AdminDashboardService);
    usersService = module.get<AdminUsersService>(AdminUsersService);
    paymentsService = module.get<AdminPaymentsService>(AdminPaymentsService);
    billingAdminService = module.get<AdminBillingService>(AdminBillingService);
  });

  describe('1. Admin Authentication & Role Isolation (BR-17.1)', () => {
    it('chặn tài khoản USER thông thường đăng nhập vào giao diện Admin (trả về 403 Forbidden)', async () => {
      const hashedPassword = await bcrypt.hash('UserPassword@123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        password: hashedPassword,
        role: Role.USER,
      });

      await expect(
        authService.login({
          email: 'user@example.com',
          password: 'UserPassword@123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cho phép tài khoản ADMIN đăng nhập đúng mật khẩu và ghi nhận AuditLog', async () => {
      const hashedPassword = await bcrypt.hash('AdminPassword@123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin_1',
        email: 'admin@nutriwise.vn',
        name: 'Tổng Quản Trị',
        password: hashedPassword,
        role: Role.ADMIN,
      });

      const res = await authService.login(
        {
          email: 'admin@nutriwise.vn',
          password: 'AdminPassword@123',
        },
        { ipAddress: '127.0.0.1', userAgent: 'Chrome' },
      );

      expect(res.data.accessToken).toBe('mock_token_jwt');
      expect(res.data.admin.role).toBe(Role.ADMIN);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'LOGIN',
            adminId: 'admin_1',
          }),
        }),
      );
    });

    it('từ chối đăng nhập khi sai mật khẩu và khoá tạm 15 phút sau 5 lần sai liên tiếp', async () => {
      const hashedPassword = await bcrypt.hash('CorrectPassword@123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin_1',
        email: 'test_admin@nutriwise.vn',
        password: hashedPassword,
        role: Role.ADMIN,
      });

      // 4 lần đầu sai: trả 401
      for (let i = 0; i < 4; i++) {
        await expect(
          authService.login({
            email: 'test_admin@nutriwise.vn',
            password: 'WrongPassword',
          }),
        ).rejects.toThrow(UnauthorizedException);
      }

      // Lần thứ 5 sai: trả 401 và kích hoạt khoá
      await expect(
        authService.login({
          email: 'test_admin@nutriwise.vn',
          password: 'WrongPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);

      // Lần thứ 6: bị chặn bởi cơ chế khoá tạm 15 phút (trả 403 Forbidden)
      await expect(
        authService.login({
          email: 'test_admin@nutriwise.vn',
          password: 'CorrectPassword@123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('2. Dashboard KPI Summary', () => {
    it('trả về đúng cấu trúc chỉ số KPI tổng quan thời gian thực', async () => {
      prisma.user.count
        .mockResolvedValueOnce(120) // total
        .mockResolvedValueOnce(15) // new 7d
        .mockResolvedValueOnce(45); // new 30d

      prisma.subscriptionState.count.mockResolvedValue(25);
      prisma.paymentOrder.count
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(50); // paid

      prisma.paymentOrder.aggregate.mockResolvedValue({
        _sum: { amount: 5000000 },
      });

      const res = await dashboardService.getDashboardSummary();
      expect(res.data.users.total).toBe(120);
      expect(res.data.users.newLast7Days).toBe(15);
      expect(res.data.subscriptions.activePremiums).toBe(25);
      expect(res.data.orders.pending).toBe(3);
      expect(res.data.orders.paid).toBe(50);
      expect(res.data.orders.totalRevenueVnd).toBe(5000000);
    });
  });

  describe('3. Quản lý Người dùng & Quyền riêng tư (BR-17.1)', () => {
    it('danh sách user phân trang không lộ dữ liệu sức khoẻ / bữa ăn cá nhân', async () => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          email: 'customer@gmail.com',
          name: 'Nguyễn Văn A',
          role: Role.USER,
          isActive: true,
          createdAt: new Date(),
          subscriptionState: {
            productId: 'monthly',
            status: 'ACTIVE',
            expiryTime: new Date(),
            autoRenewing: false,
          },
        },
      ]);

      const res = await usersService.getUsers({ page: 1, limit: 10 });
      expect(res.data.items.length).toBe(1);
      const user = res.data.items[0];
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('subscriptionState');
      // Đảm bảo không chứa các trường sức khoẻ riêng tư
      expect(user).not.toHaveProperty('weightKg');
      expect(user).not.toHaveProperty('heightCm');
      expect(user).not.toHaveProperty('meals');
    });

    it('getUserBilling trả về lịch sử nạp tiền và gói của người dùng', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'customer@gmail.com',
        name: 'Nguyễn Văn A',
        purchases: [],
        manualGrants: [],
        paymentOrders: [],
      });

      const res = await usersService.getUserBilling('u1');
      expect(res.data.id).toBe('u1');
      expect(res.data).toHaveProperty('billingEvents');
    });
  });

  describe('4. Quản lý Đơn thanh toán VietQR (BR-17.2)', () => {
    it('approveOrder: duyệt đơn nạp tiền, hoàn tất đơn và ghi AuditLog', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'order_1',
        code: 'NWK7M2QX9A',
        status: 'PENDING',
        userId: 'u1',
      });
      paymentsServiceMock.adminApprove.mockResolvedValue({
        alreadyPaid: false,
        orderId: 'order_1',
        code: 'NWK7M2QX9A',
      });

      const res = await paymentsService.approveOrder(
        'admin_1',
        'admin@nutriwise.vn',
        'order_1',
      );
      expect(paymentsServiceMock.adminApprove).toHaveBeenCalledWith(
        'admin_1',
        'order_1',
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'APPROVE_PAYMENT',
            targetId: 'order_1',
          }),
        }),
      );
      expect(res.message).toContain('Duyệt đơn thanh toán thành công');
    });

    it('rejectOrder: huỷ đơn nạp tiền và ghi AuditLog', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'order_2',
        status: 'PENDING',
      });
      prisma.paymentOrder.update.mockResolvedValue({
        id: 'order_2',
        status: 'CANCELED',
      });

      const res = await paymentsService.rejectOrder(
        'admin_1',
        'admin@nutriwise.vn',
        'order_2',
        'Khách huỷ',
      );
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order_2' },
          data: { status: 'CANCELED' },
        }),
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REJECT_PAYMENT',
          }),
        }),
      );
      expect(res.message).toContain('Huỷ đơn thanh toán thành công');
    });
  });

  describe('5. Cấp & Thu hồi Premium thủ công (BR-17.3)', () => {
    it('grantPremium: cấp ngày Premium, cộng dồn hạn và ghi BillingEvent + AuditLog', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.manualGrant.findFirst.mockResolvedValue(null);
      prisma.manualGrant.create.mockImplementation((args: any) => ({
        id: 'grant_1',
        ...args.data,
      }));

      const res = await billingAdminService.grantPremium(
        'admin_1',
        'admin@nutriwise.vn',
        {
          userId: 'u1',
          days: 30,
          reason: 'Tặng tester tham gia kiểm thử hệ thống',
        },
      );

      expect(prisma.manualGrant.create).toHaveBeenCalled();
      expect(prisma.billingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'ADMIN_GRANT',
          }),
        }),
      );
      expect(billingServiceMock.invalidate).toHaveBeenCalledWith('u1');
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'GRANT_PREMIUM',
            targetId: 'u1',
          }),
        }),
      );
      expect(res.message).toContain('Cấp 30 ngày Premium thành công');
    });

    it('revokeGrant: thu hồi quyền Premium đã cấp và huỷ cache', async () => {
      prisma.manualGrant.findUnique.mockResolvedValue({
        id: 'grant_1',
        userId: 'u1',
        revokedAt: null,
      });
      prisma.manualGrant.update.mockResolvedValue({
        id: 'grant_1',
        revokedAt: new Date(),
      });

      const res = await billingAdminService.revokeGrant(
        'admin_1',
        'admin@nutriwise.vn',
        'grant_1',
        {
          reason: 'Thu hồi quyền thử nghiệm sau khi hoàn tất',
        },
      );

      expect(prisma.manualGrant.update).toHaveBeenCalled();
      expect(prisma.billingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADMIN_REVOKE',
          }),
        }),
      );
      expect(billingServiceMock.invalidate).toHaveBeenCalledWith('u1');
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REVOKE_PREMIUM',
          }),
        }),
      );
      expect(res.message).toContain('Thu hồi quyền Premium thành công');
    });
  });
});
