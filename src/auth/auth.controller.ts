import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Headers,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  ReauthPasswordDto,
  ReauthGoogleDto,
  DeleteAccountDto,
} from './dto/reauth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản người dùng mới' })
  @ApiResponse({
    status: 201,
    description: 'Đăng ký thành công, trả về User & Tokens',
  })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại' })
  async register(
    @Body() registerDto: RegisterDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.register(registerDto, userAgent);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập hệ thống' })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập thành công, trả về Tokens',
  })
  @ApiResponse({ status: 401, description: 'Email hoặc mật khẩu không đúng' })
  @ApiResponse({ status: 403, description: 'Tài khoản bị khóa' })
  async login(
    @Body() loginDto: LoginDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(loginDto, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Làm mới Access Token bằng Refresh Token (BR-01.3)',
  })
  @ApiResponse({ status: 200, description: 'Cấp mới token thành công' })
  @ApiResponse({
    status: 401,
    description: 'Refresh token không hợp lệ hoặc hết hạn / bị thu hồi',
  })
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refreshTokens(refreshTokenDto, userAgent);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất phiên hiện tại' })
  @ApiResponse({ status: 200, description: 'Đăng xuất thành công' })
  async logout(
    @CurrentUser('id') userId: string,
    @Body() body?: { refreshToken?: string },
  ) {
    return this.authService.logout(userId, body?.refreshToken);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất khỏi toàn bộ thiết bị (BR-01.3)' })
  @ApiResponse({ status: 200, description: 'Đăng xuất tất cả thành công' })
  async logoutAll(@CurrentUser('id') userId: string) {
    return this.authService.logoutAll(userId);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem danh sách thiết bị đang đăng nhập (BR-01.3)' })
  @ApiResponse({ status: 200, description: 'Danh sách các phiên đăng nhập' })
  async getSessions(@CurrentUser('id') userId: string) {
    return this.authService.getSessions(userId);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thu hồi phiên đăng nhập từ xa theo ID (BR-01.3)' })
  @ApiResponse({ status: 200, description: 'Thu hồi phiên thành công' })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(userId, sessionId);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đổi mật khẩu người dùng' })
  @ApiResponse({ status: 200, description: 'Đổi mật khẩu thành công' })
  @ApiResponse({
    status: 409,
    description: 'Mật khẩu cũ không chính xác hoặc trùng mật khẩu mới',
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, changePasswordDto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu gửi mã OTP đặt lại mật khẩu qua email' })
  @ApiResponse({
    status: 200,
    description:
      'Luôn trả về thông báo chung (không tiết lộ email có tồn tại hay không)',
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đặt lại mật khẩu bằng mã OTP đã gửi' })
  @ApiResponse({ status: 200, description: 'Đặt lại mật khẩu thành công' })
  @ApiResponse({ status: 400, description: 'Mã không hợp lệ hoặc đã hết hạn' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.email,
      resetPasswordDto.code,
      resetPasswordDto.newPassword,
    );
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập/Đăng ký bằng Google Sign-In (idToken)' })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập Google thành công, trả về User & Tokens',
  })
  @ApiResponse({ status: 401, description: 'idToken không hợp lệ' })
  async loginWithGoogle(
    @Body() googleLoginDto: GoogleLoginDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.loginWithGoogle(googleLoginDto.idToken, userAgent);
  }

  @Post('send-verification-email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gửi (hoặc gửi lại) mã OTP xác thực email' })
  @ApiResponse({ status: 200, description: 'Đã gửi mã xác thực' })
  async sendVerificationEmail(@CurrentUser('id') userId: string) {
    return this.authService.sendVerificationEmail(userId);
  }

  @Post('verify-email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xác thực email bằng mã OTP' })
  @ApiResponse({ status: 200, description: 'Xác thực thành công' })
  @ApiResponse({ status: 400, description: 'Mã không hợp lệ hoặc đã hết hạn' })
  async verifyEmail(
    @CurrentUser('id') userId: string,
    @Body() verifyEmailDto: VerifyEmailDto,
  ) {
    return this.authService.verifyEmail(userId, verifyEmailDto.code);
  }

  @Post('reauth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác thực lại bằng mật khẩu trước thao tác nhạy cảm (BR-01.4)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trả về reauthToken hiệu lực 5 phút',
  })
  @ApiResponse({ status: 401, description: 'Mật khẩu không chính xác' })
  async reauth(
    @CurrentUser('id') userId: string,
    @Body() dto: ReauthPasswordDto,
  ) {
    return this.authService.reauth(userId, dto.password);
  }

  @Post('reauth/google')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Xác thực lại bằng Google idToken trước thao tác nhạy cảm (BR-01.4)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trả về reauthToken hiệu lực 5 phút',
  })
  @ApiResponse({ status: 401, description: 'Tài khoản Google không khớp' })
  async reauthGoogle(
    @CurrentUser('id') userId: string,
    @Body() dto: ReauthGoogleDto,
  ) {
    return this.authService.reauthGoogle(userId, dto.idToken);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Xóa vĩnh viễn tài khoản người dùng và toàn bộ dữ liệu liên quan (BR-01.4)',
  })
  @ApiResponse({ status: 200, description: 'Xóa tài khoản thành công' })
  @ApiResponse({ status: 401, description: 'Cần reauthToken hợp lệ' })
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Headers('x-reauth-token') headerToken?: string,
    @Body() body?: DeleteAccountDto,
  ) {
    const reauthToken = headerToken || body?.reauthToken;
    return this.authService.deleteAccount(userId, reauthToken);
  }

  @Get('privacy-policy')
  @ApiOperation({ summary: 'Chính sách Quyền riêng tư của NutriWise (BR-18)' })
  @ApiResponse({
    status: 200,
    description: 'Nội dung chính sách quyền riêng tư',
  })
  getPrivacyPolicy() {
    return this.authService.getPrivacyPolicy();
  }
}
