import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminAuditService } from '../services/admin-audit.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Audit')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Xem danh sách nhật ký kiểm toán hành động của Admin',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'action', required: false, example: 'APPROVE_PAYMENT' })
  @ApiQuery({ name: 'targetType', required: false, example: 'PaymentOrder' })
  @ApiResponse({ status: 200, description: 'Lấy nhật ký thành công' })
  async getAuditLogs(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
  ) {
    return this.auditService.getAuditLogs({ page, limit, action, targetType });
  }
}
