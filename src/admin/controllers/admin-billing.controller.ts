import {
  Controller,
  Post,
  Param,
  Body,
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
import { AdminBillingService } from '../services/admin-billing.service';
import {
  AdminGrantPremiumDto,
  AdminRevokeGrantDto,
} from '../dto/admin-grant-premium.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Billing')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billingService: AdminBillingService) {}

  @Post('grants')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cấp ngày Premium thủ công cho người dùng (tối đa 90 ngày)',
  })
  @ApiResponse({ status: 201, description: 'Cấp Premium thành công' })
  async grantPremium(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Body() dto: AdminGrantPremiumDto,
  ) {
    return this.billingService.grantPremium(adminId, adminEmail, dto);
  }

  @Post('grants/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thu hồi quyền Premium đã cấp thủ công' })
  @ApiResponse({ status: 200, description: 'Thu hồi thành công' })
  async revokeGrant(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') grantId: string,
    @Body() dto: AdminRevokeGrantDto,
  ) {
    return this.billingService.revokeGrant(adminId, adminEmail, grantId, dto);
  }
}
