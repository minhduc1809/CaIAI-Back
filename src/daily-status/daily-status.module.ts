import { Module } from '@nestjs/common';
import { DailyStatusController } from './daily-status.controller';
import { DailyStatusService } from './daily-status.service';

@Module({
  controllers: [DailyStatusController],
  providers: [DailyStatusService],
  exports: [DailyStatusService],
})
export class DailyStatusModule {}
