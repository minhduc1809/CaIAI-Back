import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { PaymentsService, QR_PLANS } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreatePaymentOrderDto {
  @IsString()
  @IsIn(QR_PLANS.map((p) => p.productId))
  productId: string;
}

@ApiTags('Payments (QR ngân hàng)')
@ApiBearerAuth('access-token')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('plans')
  @ApiOperation({ summary: 'Các gói bán qua QR và giá' })
  plans() {
    return this.payments.plans();
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tạo đơn và nhận mã QR chuyển khoản (hiệu lực 30 phút)' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreatePaymentOrderDto) {
    return this.payments.createOrder(userId, dto.productId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:id')
  @ApiOperation({ summary: 'Xem trạng thái đơn (app gọi định kỳ để biết đã được duyệt chưa)' })
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.payments.getOrder(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Huỷ đơn đang chờ' })
  cancel(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.payments.cancelOrder(userId, id);
  }

  @Get('admin/orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'ADMIN: đơn đang chờ và đơn hết hạn trong 7 ngày gần đây' })
  adminList() {
    return this.payments.adminListOrders();
  }

  @Post('admin/orders/:id/approve')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'ADMIN: xác nhận đã nhận tiền và cấp Premium' })
  adminApprove(@CurrentUser('id') adminId: string, @Param('id') id: string) {
    return this.payments.adminApprove(adminId, id);
  }

  /** Webhook SePay: xác thực bằng khoá API trong header, không dùng JWT người dùng. */
  @Post('webhook/sepay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Nhận biến động số dư từ ngân hàng (SePay) và tự duyệt đơn' })
  sepay(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.payments.handleBankWebhook(authorization, body);
  }
}
