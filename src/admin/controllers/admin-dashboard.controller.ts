import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminDashboardService } from '../services/admin-dashboard.service';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Dashboard')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(
    private readonly dashboardService: AdminDashboardService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Các chỉ số KPI tổng quan hệ thống (bản gọn, giữ tương thích)' })
  @ApiResponse({ status: 200, description: 'Lấy dữ liệu thành công' })
  async getDashboard() {
    return this.dashboardService.getDashboardSummary();
  }

  @Get('pending')
  @ApiOperation({ summary: 'Việc đang chờ admin xử lý: đơn QR, món chờ duyệt, yêu cầu dữ liệu, gia hạn lỗi' })
  pending() {
    return this.analytics.pendingWork();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Thẻ KPI theo khoảng thời gian, kèm số liệu kỳ trước để so sánh' })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.overview(from, to);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Chuỗi theo ngày: người dùng mới, người dùng hoạt động, doanh thu, đơn đã thanh toán' })
  timeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.timeseries(from, to);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Phễu chuyển đổi theo cohort (đăng ký → onboarding → bữa đầu → quay lại 7 ngày → Premium)' })
  funnel(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.funnel(from, to);
  }

  @Get('retention')
  @ApiOperation({ summary: 'Giữ chân D1/D7/D30 theo cohort đăng ký' })
  retention(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.retention(from, to);
  }
}
