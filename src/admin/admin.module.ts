import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { PaymentsModule } from '../payments/payments.module';
import { BillingModule } from '../billing/billing.module';
import { FoodCatalogModule } from '../food-catalog/food-catalog.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExerciseCatalogModule } from '../exercise-catalog/exercise-catalog.module';

import { AdminAuditService } from './services/admin-audit.service';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminTotpService } from './services/admin-totp.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminPaymentsService } from './services/admin-payments.service';
import { AdminBillingService } from './services/admin-billing.service';
import { AdminAiUsageService } from './services/admin-ai-usage.service';
import { AdminFoodsService } from './services/admin-foods.service';
import { AdminFoodSubmissionsService } from './services/admin-food-submissions.service';
import { AdminExercisesService } from './services/admin-exercises.service';
import { AdminFoodImportService } from './services/admin-food-import.service';
import { AdminDataRequestsService } from './services/admin-data-requests.service';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminRevenueService } from './services/admin-revenue.service';
import { AdminSystemHealthService } from './services/admin-system-health.service';
import { AdminExportService } from './services/admin-export.service';
import { AdminReauthService } from './services/admin-reauth.service';

import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminAiUsageController } from './controllers/admin-ai-usage.controller';
import { AdminFoodsController } from './controllers/admin-foods.controller';
import { AdminConfigController } from './controllers/admin-config.controller';
import { AdminExercisesController } from './controllers/admin-exercises.controller';
import { AdminDataRequestsController } from './controllers/admin-data-requests.controller';
import { AdminRevenueController } from './controllers/admin-revenue.controller';
import { AdminSystemHealthController } from './controllers/admin-system-health.controller';
import { AdminExportsController } from './controllers/admin-exports.controller';
import { AdminFoodSubmissionsController } from './controllers/admin-food-submissions.controller';

import { AdminAuthGuard } from './guards/admin-auth.guard';

@Module({
  imports: [
    PaymentsModule,
    BillingModule,
    FoodCatalogModule,
    NotificationsModule,
    ExerciseCatalogModule,
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
    AdminAiUsageController,
    AdminFoodsController,
    AdminFoodSubmissionsController,
    AdminConfigController,
    AdminExercisesController,
    AdminDataRequestsController,
    AdminRevenueController,
    AdminSystemHealthController,
    AdminExportsController,
  ],
  providers: [
    AdminAuditService,
    AdminAuthService,
    AdminTotpService,
    AdminDashboardService,
    AdminUsersService,
    AdminPaymentsService,
    AdminBillingService,
    AdminAiUsageService,
    AdminFoodsService,
    AdminFoodSubmissionsService,
    AdminExercisesService,
    AdminFoodImportService,
    AdminDataRequestsService,
    AdminAnalyticsService,
    AdminRevenueService,
    AdminSystemHealthService,
    AdminExportService,
    AdminReauthService,
    AdminAuthGuard,
  ],
  exports: [AdminAuditService, AdminAuthGuard],
})
export class AdminModule {}
