import { Module } from '@nestjs/common';
import { WeeklySummaryService } from './weekly-summary.service';
import { WeeklySummaryController } from './weekly-summary.controller';
import { MealsModule } from '../meals/meals.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MealsModule, NotificationsModule],
  controllers: [WeeklySummaryController],
  providers: [WeeklySummaryService],
  exports: [WeeklySummaryService],
})
export class WeeklySummaryModule {}
