import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaymentsService } from '../services/admin-payments.service';
import { QueryOrdersDto, RejectOrderDto } from '../dto/query-orders.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class ApproveOrderDto {
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class OrderNoteDto {
  @IsString() @MaxLength(500) note: string;
}

@ApiTags('Admin - Payments')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly paymentsService: AdminPaymentsService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Danh sách đơn chuyển khoản VietQR: lọc trạng thái, ngày, khoảng tiền, tìm mã/email, sắp xếp' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getOrders(@Query() query: QueryOrdersDto) {
    return this.paymentsService.getOrders(query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Chi tiết đơn: thông tin đối soát, cảnh báo quá hạn và lịch sử xử lý' })
  getOrder(@Param('id') orderId: string) {
    return this.paymentsService.getOrderDetail(orderId);
  }

  @Patch('orders/:id/note')
  @ApiOperation({ summary: 'Ghi chú nội bộ cho đơn (không đổi trạng thái)' })
  setNote(@CurrentUser('id') adminId: string, @CurrentUser('email') adminEmail: string, @Param('id') orderId: string, @Body() dto: OrderNoteDto) {
    return this.paymentsService.setOrderNote(adminId, adminEmail, orderId, dto.note);
  }

  @Post('orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt đơn (kích hoạt Premium). Backend kiểm tra lại mật khẩu admin' })
  @ApiResponse({ status: 200, description: 'Duyệt đơn thành công' })
  async approveOrder(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') orderId: string,
    @Body() dto: ApproveOrderDto,
  ) {
    return this.paymentsService.approveOrder(adminId, adminEmail, orderId, dto);
  }

  @Post('orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Huỷ đơn: bắt buộc lý do và mật khẩu admin' })
  @ApiResponse({ status: 200, description: 'Huỷ đơn thành công' })
  async rejectOrder(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') orderId: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.paymentsService.rejectOrder(adminId, adminEmail, orderId, dto?.reason, dto?.password);
  }
}
