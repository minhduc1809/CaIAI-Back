import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class VerifyPurchaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  purchaseToken: string;

  @IsString()
  @IsNotEmpty()
  productId: string;
}

@ApiTags('Billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('billing/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Xác minh giao dịch Google Play ở server và trả entitlement (BR-16.4)',
  })
  verify(@CurrentUser('id') userId: string, @Body() dto: VerifyPurchaseDto) {
    return this.billing.verify(userId, dto);
  }

  @Get('me/entitlement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Gói hiện tại, hạn mức và mức đã dùng hôm nay (BR-15.3)' })
  entitlement(@CurrentUser('id') userId: string) {
    return this.billing.getEntitlement(userId);
  }

  /** Đầu nhận đẩy từ Pub/Sub; xác thực bằng JWT của Pub/Sub, không dùng JWT người dùng. */
  @Post('billing/rtdn')
  @HttpCode(200)
  @ApiOperation({ summary: 'Nhận thông báo thay đổi gói từ Google (RTDN)' })
  rtdn(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.billing.handleRtdn(authorization, body);
  }
}
