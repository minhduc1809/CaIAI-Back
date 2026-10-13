import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemConfigService } from './system-config.service';

@ApiTags('Config')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('config')
export class PublicConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get('public')
  @ApiOperation({ summary: 'Tham số app cần để hiển thị (không gồm tham số quản trị)' })
  async publicConfig() {
    return { message: 'Lấy tham số thành công', data: await this.config.publicConfig() };
  }
}
