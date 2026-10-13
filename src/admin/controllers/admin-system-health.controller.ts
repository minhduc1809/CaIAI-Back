import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminSystemHealthService } from '../services/admin-system-health.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Sức khỏe hệ thống')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/system')
export class AdminSystemHealthController {
  constructor(private readonly health: AdminSystemHealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Trạng thái hệ thống (chỉ đọc): cơ sở dữ liệu, AI, email, Google Play, độ trễ, lỗi 500, sao lưu, phiên bản' })
  getHealth() {
    return this.health.getHealth();
  }
}
