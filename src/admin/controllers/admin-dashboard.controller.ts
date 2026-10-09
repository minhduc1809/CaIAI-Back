import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminDashboardService } from '../services/admin-dashboard.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Dashboard')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy các chỉ số KPI tổng quan hệ thống' })
  @ApiResponse({ status: 200, description: 'Lấy dữ liệu thành công' })
  async getDashboard() {
    return this.dashboardService.getDashboardSummary();
  }
}
