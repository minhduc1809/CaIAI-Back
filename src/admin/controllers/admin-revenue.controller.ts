import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminRevenueService } from '../services/admin-revenue.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Doanh thu')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/revenue')
export class AdminRevenueController {
  constructor(private readonly revenue: AdminRevenueService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Doanh thu thực nhận theo ngày/tháng, đơn thành công/hết hạn/huỷ, Premium mới/gia hạn/rời bỏ' })
  @ApiQuery({ name: 'group', required: false, enum: ['day', 'month'] })
  summary(@Query('from') from?: string, @Query('to') to?: string, @Query('group') group?: string) {
    return this.revenue.summary(from, to, group === 'month' ? 'month' : 'day');
  }

  @Get('orders')
  @ApiOperation({ summary: 'Các đơn đã thanh toán trong kỳ (theo thời điểm thanh toán)' })
  orders(@Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.revenue.paidOrders(from, to, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }
}
