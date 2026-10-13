import { PremiumGuard, RequiresPremium } from '../billing/premium.guard';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { WeeklySummaryService } from './weekly-summary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WeeklySummaryResponseDto } from './dto/weekly-summary-response.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class WeeklySummaryController {
  constructor(private readonly weeklySummaryService: WeeklySummaryService) {}

  @Get('weekly-summary')
  @ApiOperation({
    summary:
      'Tổng hợp hoạt động 7 ngày gần nhất (dinh dưỡng, cân nặng, tập luyện) kèm highlight do AI viết',
    description:
      'Kỳ dữ liệu trùng kỳ Check-in: 7 ngày kết thúc hôm qua của ngày Check-in gần nhất (User.checkinDay, múi giờ người dùng), chỉ ngày ghi đủ vào trung bình. Kết quả được cache theo kỳ để tránh gọi Gemini lặp lại.',
  })
  @ApiResponse({ status: 200, type: WeeklySummaryResponseDto })
  async getWeeklySummary(
    @CurrentUser('id') userId: string,
  ): Promise<WeeklySummaryResponseDto> {
    return this.weeklySummaryService.getWeeklySummary(userId);
  }

  @Post('weekly-summary/regenerate')
  @UseGuards(PremiumGuard)
  @RequiresPremium()
  @ApiOperation({
    summary: 'Buộc tạo lại tổng hợp tuần hiện tại (bỏ qua cache)',
  })
  @ApiResponse({ status: 201, type: WeeklySummaryResponseDto })
  async regenerateWeeklySummary(
    @CurrentUser('id') userId: string,
  ): Promise<WeeklySummaryResponseDto> {
    return this.weeklySummaryService.regenerateWeeklySummary(userId);
  }
}
