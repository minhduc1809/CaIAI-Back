import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { PaymentsModule } from '../payments/payments.module';
import { BillingModule } from '../billing/billing.module';

import { AdminAuditService } from './services/admin-audit.service';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminPaymentsService } from './services/admin-payments.service';
import { AdminBillingService } from './services/admin-billing.service';

import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';

import { AdminAuthGuard } from './guards/admin-auth.guard';

@Module({
  imports: [
    PaymentsModule,
    BillingModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_ACCESS_SECRET') ||
          'default_jwt_secret',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ||
            '15m') as any,
        },
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminUsersController,
    AdminPaymentsController,
    AdminBillingController,
    AdminAuditController,
  ],
  providers: [
    AdminAuditService,
    AdminAuthService,
    AdminDashboardService,
    AdminUsersService,
    AdminPaymentsService,
    AdminBillingService,
    AdminAuthGuard,
  ],
  exports: [AdminAuditService, AdminAuthGuard],
})
export class AdminModule {}
