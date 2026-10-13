import { AdminTotpService } from '../services/admin-totp.service';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Ip,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class TotpCodeDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class TotpDisableDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

@ApiTags('Admin - Auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly totp: AdminTotpService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập dành riêng cho Quản trị viên (Admin)' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công' })
  @ApiResponse({
    status: 403,
    description: 'Từ chối: không phải tài khoản quản trị hoặc bị khoá tạm',
  })
  async login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.login(dto, { ipAddress: ip, userAgent });
  }

  @Get('totp/status')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trạng thái xác thực hai lớp (TOTP) của tôi' })
  totpStatus(@CurrentUser('id') adminId: string) {
    return this.totp.status(adminId);
  }

  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bắt đầu đăng ký TOTP: trả bí mật và đường dẫn otpauth để tạo mã QR' })
  totpSetup(@CurrentUser('id') adminId: string, @CurrentUser('email') email: string) {
    return this.totp.setup(adminId, email);
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xác nhận mã đầu tiên để bật TOTP; trả mã dự phòng một lần duy nhất' })
  totpEnable(@CurrentUser('id') adminId: string, @Body() dto: TotpCodeDto) {
    return this.totp.enable(adminId, dto.code);
  }

  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tắt TOTP (cần mật khẩu và một mã hợp lệ)' })
  totpDisable(@CurrentUser('id') adminId: string, @Body() dto: TotpDisableDto) {
    return this.totp.disable(adminId, dto.password, dto.code);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản Quản trị viên đang đăng nhập',
  })
  @ApiResponse({ status: 200, description: 'Lấy thông tin thành công' })
  async getMe(@CurrentUser('id') adminId: string) {
    return this.authService.getMe(adminId);
  }
}
