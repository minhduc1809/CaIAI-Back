import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuditService } from '../admin/services/admin-audit.service';
import { SystemConfigService } from './system-config.service';
import { PublicConfigController } from './public-config.controller';

/** Toàn cục để mọi module đọc `cfg()`; service nạp ghi đè từ DB khi khởi động và làm mới định kỳ. */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PublicConfigController],
  providers: [SystemConfigService, AdminAuditService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
