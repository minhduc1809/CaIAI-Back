import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
import { CheckinsService } from './checkins.service';
import { UsersModule } from '../users/users.module';
import { WeightLogsModule } from '../weight-logs/weight-logs.module';

@Module({
  imports: [UsersModule, WeightLogsModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
  exports: [CheckinsService],
})
export class CheckinsModule {}
