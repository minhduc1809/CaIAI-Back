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
      'Tính từ Thứ 2 tuần hiện tại đến hôm nay. Kết quả được cache lại trong tuần (sinh mới nếu chưa có hoặc đã sang tuần mới) để tránh gọi Gemini lặp lại.',
  })
  @ApiResponse({ status: 200, type: WeeklySummaryResponseDto })
  async getWeeklySummary(
    @CurrentUser('id') userId: string,
  ): Promise<WeeklySummaryResponseDto> {
    return this.weeklySummaryService.getWeeklySummary(userId);
  }

  @Post('weekly-summary/regenerate')
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
