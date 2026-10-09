import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { MealsModule } from './meals/meals.module';
import { WeightLogsModule } from './weight-logs/weight-logs.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CheckinsModule } from './checkins/checkins.module';
import { WeeklySummaryModule } from './weekly-summary/weekly-summary.module';
import { HabitRemindersModule } from './habit-reminders/habit-reminders.module';
import { WaterLogsModule } from './water-logs/water-logs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DailyStatusModule } from './daily-status/daily-status.module';
import { DataExportModule } from './data-export/data-export.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { PaymentsModule } from './payments/payments.module';
import { BillingModule } from './billing/billing.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RecommendationsModule,
    MealsModule,
    WeightLogsModule,
    WorkoutsModule,
    AiModule,
    AnalyticsModule,
    CheckinsModule,
    WeeklySummaryModule,
    HabitRemindersModule,
    WaterLogsModule,
    NotificationsModule,
    DailyStatusModule,
    BillingModule,
    PaymentsModule,
    MealPlanModule,
    DataExportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
