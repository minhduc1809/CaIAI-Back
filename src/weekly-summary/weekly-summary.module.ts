import { Module } from '@nestjs/common';
import { WeeklySummaryService } from './weekly-summary.service';
import { WeeklySummaryController } from './weekly-summary.controller';
import { MealsModule } from '../meals/meals.module';

@Module({
  imports: [MealsModule],
  controllers: [WeeklySummaryController],
  providers: [WeeklySummaryService],
  exports: [WeeklySummaryService],
})
export class WeeklySummaryModule {}
