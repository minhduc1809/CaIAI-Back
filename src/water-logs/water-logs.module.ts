import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WaterLogsController } from './water-logs.controller';
import { WaterLogsService } from './water-logs.service';

@Module({
  imports: [PrismaModule],
  controllers: [WaterLogsController],
  providers: [WaterLogsService],
})
export class WaterLogsModule {}
