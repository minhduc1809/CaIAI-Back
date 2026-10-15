import { Module } from '@nestjs/common';
import { WeightLogsService } from './weight-logs.service';
import { WeightLogsController } from './weight-logs.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [WeightLogsController],
  providers: [WeightLogsService],
  exports: [WeightLogsService],
})
export class WeightLogsModule {}
