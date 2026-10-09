import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { GooglePlayClient, HttpGooglePlayClient } from './google-play.client';
import { PremiumGuard } from './premium.guard';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    PremiumGuard,
    { provide: GooglePlayClient, useClass: HttpGooglePlayClient },
  ],
  exports: [BillingService, PremiumGuard],
})
export class BillingModule {}
