import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminUsersService } from '../services/admin-users.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';

@ApiTags('Admin - Users')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Tìm kiếm và phân trang danh sách người dùng' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getUsers(@Query() query: QueryUsersDto) {
    return this.usersService.getUsers(query);
  }

  @Get(':id/billing')
  @ApiOperation({
    summary: 'Xem lịch sử giao dịch và trạng thái gói cước của người dùng',
  })
  @ApiResponse({ status: 200, description: 'Lấy thông tin thành công' })
  async getUserBilling(@Param('id') userId: string) {
    return this.usersService.getUserBilling(userId);
  }
}
