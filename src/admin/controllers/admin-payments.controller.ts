import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminPaymentsService } from '../services/admin-payments.service';
import { QueryOrdersDto, RejectOrderDto } from '../dto/query-orders.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Payments')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly paymentsService: AdminPaymentsService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Danh sách các đơn thanh toán chuyển khoản VietQR' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getOrders(@Query() query: QueryOrdersDto) {
    return this.paymentsService.getOrders(query);
  }

  @Post('orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Duyệt đơn nạp tiền thủ công (kích hoạt Premium)' })
  @ApiResponse({ status: 200, description: 'Duyệt đơn thành công' })
  async approveOrder(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') orderId: string,
  ) {
    return this.paymentsService.approveOrder(adminId, adminEmail, orderId);
  }

  @Post('orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Huỷ / Từ chối đơn nạp tiền' })
  @ApiResponse({ status: 200, description: 'Huỷ đơn thành công' })
  async rejectOrder(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') orderId: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.paymentsService.rejectOrder(
      adminId,
      adminEmail,
      orderId,
      dto?.reason,
    );
  }
}
