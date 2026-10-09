import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
import { CheckinsService } from './checkins.service';
import { UsersModule } from '../users/users.module';
import { WeightLogsModule } from '../weight-logs/weight-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [UsersModule, WeightLogsModule, NotificationsModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
  exports: [CheckinsService],
})
export class CheckinsModule {}
