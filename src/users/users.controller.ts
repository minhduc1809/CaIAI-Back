import {
  Controller,
  Get,
  Patch,
  Post,
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
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin hồ sơ của người dùng hiện tại' })
  @ApiResponse({ status: 200, description: 'Lấy thông tin thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cập nhật thông số cơ thể và tự động tính toán BMI, BMR, TDEE, Calo mục tiêu',
  })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công, trả về các chỉ số mới',
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Post('me/target/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Áp dụng mục tiêu tính lại từ hồ sơ hiện tại (sự kiện E5, user bấm "Áp dụng")',
  })
  @ApiResponse({ status: 200, description: 'Đã áp dụng mục tiêu mới' })
  async applyTarget(@CurrentUser('id') userId: string) {
    return this.usersService.applyProposedTarget(userId);
  }

  @Get('me/target/history')
  @ApiOperation({ summary: 'Lịch sử thay đổi mục tiêu calo/macro' })
  @ApiResponse({ status: 200, description: 'Lấy lịch sử thành công' })
  async getTargetHistory(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getTargetHistory(
      userId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('me/health-summary')
  @ApiOperation({
    summary:
      'Lấy báo cáo phân tích sức khỏe và lời khuyên dinh dưỡng tổng quan',
  })
  @ApiResponse({ status: 200, description: 'Lấy báo cáo thành công' })
  async getHealthSummary(@CurrentUser('id') userId: string) {
    return this.usersService.getHealthSummary(userId);
  }

  @Get('me/expenditure')
  @ApiOperation({
    summary:
      'Xem trạng thái Adaptive Expenditure Engine (Updating/Holding) kèm hướng dẫn đọc hiểu',
    description:
      'Trả về Expenditure ước tính từ dữ liệu cân nặng + calo đã log thực tế (Adaptive), hoặc TDEE công thức tĩnh nếu chưa đủ dữ liệu (Static Fallback).',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy trạng thái Expenditure thành công',
  })
  async getExpenditure(@CurrentUser('id') userId: string) {
    return this.usersService.getExpenditureStatus(userId);
  }

  @Get('me/expenditure/history')
  @ApiOperation({
    summary:
      'Lịch sử Expenditure thích ứng vs TDEE tĩnh theo thời gian (Nutrition Progress)',
    description:
      'Mỗi điểm ứng với 1 lần log cân nặng/cập nhật hồ sơ/Weekly Check-in thực sự lưu lại giá trị mới — không phải lấy mẫu theo ngày cố định.',
  })
  @ApiResponse({ status: 200, description: 'Lấy lịch sử Expenditure thành công' })
  async getExpenditureHistory(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getExpenditureHistory(
      userId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
