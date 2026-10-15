import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  // Giới hạn tần suất riêng cho webhook ngân hàng (60 yêu cầu/phút/IP), chỉ áp ở route có ThrottlerGuard
  imports: [BillingModule, NotificationsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
