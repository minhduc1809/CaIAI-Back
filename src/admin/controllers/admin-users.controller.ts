import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminUsersService } from '../services/admin-users.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { SensitiveActionDto } from '../dto/admin-sensitive.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Users')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách người dùng: tìm, lọc (gói, trạng thái, email, ngày), sắp xếp, phân trang' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getUsers(@Query() query: QueryUsersDto) {
    return this.usersService.getUsers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết người dùng: tài khoản, gói, hạn mức hôm nay (số đếm), phiên đăng nhập (không có dữ liệu sức khỏe)' })
  async getUser(@Param('id') id: string) {
    return this.usersService.getUserDetail(id);
  }

  @Get(':id/billing')
  @ApiOperation({ summary: 'Xem lịch sử giao dịch và trạng thái gói cước của người dùng' })
  @ApiResponse({ status: 200, description: 'Lấy thông tin thành công' })
  async getUserBilling(@Param('id') userId: string) {
    return this.usersService.getUserBilling(userId);
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khoá tài khoản (lý do + mật khẩu admin), thu hồi mọi phiên' })
  lock(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Param('id') userId: string, @Body() dto: SensitiveActionDto) {
    return this.usersService.lock({ id, email }, userId, dto);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mở khoá tài khoản (lý do + mật khẩu admin)' })
  unlock(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Param('id') userId: string, @Body() dto: SensitiveActionDto) {
    return this.usersService.unlock({ id, email }, userId, dto);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buộc đăng xuất mọi thiết bị của người dùng (lý do + mật khẩu admin)' })
  revokeSessions(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Param('id') userId: string, @Body() dto: SensitiveActionDto) {
    return this.usersService.revokeSessions({ id, email }, userId, dto);
  }
}
