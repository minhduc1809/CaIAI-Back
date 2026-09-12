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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
