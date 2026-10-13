import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminAiUsageService } from '../services/admin-ai-usage.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - AI')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/ai')
export class AdminAiUsageController {
  constructor(private readonly usageService: AdminAiUsageService) {}

  @Get('usage/daily')
  @ApiOperation({ summary: 'Số liệu AI theo ngày (lời gọi, lỗi, token, chi phí ước tính) trong khoảng from..to' })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  getDaily(@Query('from') from?: string, @Query('to') to?: string) {
    return this.usageService.getDaily(from, to);
  }

  @Get('usage')
  @ApiOperation({
    summary:
      'Chi phí AI thật theo tháng: tổng, theo tính năng, và phân vị chi phí mỗi người dùng (p50/p75/p95)',
  })
  @ApiQuery({ name: 'month', required: false, example: '2026-10', description: 'YYYY-MM, mặc định tháng hiện tại' })
  @ApiResponse({ status: 200, description: 'Báo cáo chi phí AI' })
  getUsage(@Query('month') month?: string) {
    return this.usageService.getUsage(month);
  }
}
