import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Cập nhật thông số cơ thể và tự động tính toán BMI, BMR, TDEE, Calo mục tiêu' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công, trả về các chỉ số mới' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Get('me/health-summary')
  @ApiOperation({ summary: 'Lấy báo cáo phân tích sức khỏe và lời khuyên dinh dưỡng tổng quan' })
  @ApiResponse({ status: 200, description: 'Lấy báo cáo thành công' })
  async getHealthSummary(@CurrentUser('id') userId: string) {
    return this.usersService.getHealthSummary(userId);
  }

  @Get('me/expenditure')
  @ApiOperation({
    summary: 'Xem trạng thái Adaptive Expenditure Engine (Updating/Holding) kèm hướng dẫn đọc hiểu',
    description:
      'Trả về Expenditure ước tính từ dữ liệu cân nặng + calo đã log thực tế (Adaptive), hoặc TDEE công thức tĩnh nếu chưa đủ dữ liệu (Static Fallback).',
  })
  @ApiResponse({ status: 200, description: 'Lấy trạng thái Expenditure thành công' })
  async getExpenditure(@CurrentUser('id') userId: string) {
    return this.usersService.getExpenditureStatus(userId);
  }
}
