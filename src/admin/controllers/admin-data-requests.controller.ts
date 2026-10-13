import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminDataRequestsService } from '../services/admin-data-requests.service';
import { CreateDataRequestDto, UpdateDataRequestDto } from '../dto/admin-data-request.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Yêu cầu quyền dữ liệu')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/data-requests')
export class AdminDataRequestsController {
  constructor(private readonly requests: AdminDataRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Hàng đợi yêu cầu (mặc định: đang mở, gần hạn nhất trước)' })
  @ApiQuery({ name: 'status', required: false })
  list(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.requests.list({ status, type, from, to, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ghi nhận yêu cầu nhận qua email' })
  create(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Body() dto: CreateDataRequestDto) {
    return this.requests.create({ id, email }, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật trạng thái (DONE/REJECTED bắt buộc ghi chú)' })
  update(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('id') requestId: string,
    @Body() dto: UpdateDataRequestDto,
  ) {
    return this.requests.update({ id, email }, requestId, dto);
  }
}
