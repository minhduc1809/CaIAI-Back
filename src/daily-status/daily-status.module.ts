import { Module } from '@nestjs/common';
import { DailyStatusController } from './daily-status.controller';
import { DailyStatusService } from './daily-status.service';
import { MealsModule } from '../meals/meals.module';

@Module({
  imports: [MealsModule],
  controllers: [DailyStatusController],
  providers: [DailyStatusService],
  exports: [DailyStatusService],
})
export class DailyStatusModule {}
