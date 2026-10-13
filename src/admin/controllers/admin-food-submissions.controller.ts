import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminFoodSubmissionsService } from '../services/admin-food-submissions.service';
import { ApproveFoodSubmissionDto, RejectFoodSubmissionDto } from '../dto/admin-food-submission.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Món người dùng gửi')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/food-submissions')
export class AdminFoodSubmissionsController {
  constructor(private readonly submissions: AdminFoodSubmissionsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách món người dùng gửi (mặc định: đang chờ duyệt, cũ nhất trước)' })
  @ApiQuery({ name: 'status', required: false, enum: ['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @ApiQuery({ name: 'duplicate', required: false, type: Boolean })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @Query('status') status?: string,
    @Query('duplicate') duplicate?: string,
    @Query('query') query?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.submissions.list({
      status,
      duplicate: duplicate === 'true',
      query,
      order,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt món: sửa số liệu nếu cần, bắt buộc khai báo thẻ an toàn và nhóm món' })
  approve(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') id: string,
    @Body() dto: ApproveFoodSubmissionDto,
  ) {
    return this.submissions.approve({ id: adminId, email: adminEmail }, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối món (bắt buộc ghi lý do, người gửi sẽ nhận thông báo)' })
  reject(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') id: string,
    @Body() dto: RejectFoodSubmissionDto,
  ) {
    return this.submissions.reject({ id: adminId, email: adminEmail }, id, dto.reason);
  }
}
