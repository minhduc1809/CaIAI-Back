import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { MealsModule } from './meals/meals.module';
import { WeightLogsModule } from './weight-logs/weight-logs.module';
import { WorkoutsModule } from './workouts/workouts.module';
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
