import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('insights')
  @ApiOperation({
    summary:
      'Insight tự động: Plateau Detection (C022) + Goal Deviation (C023)',
  })
  @ApiResponse({ status: 200, description: 'Lấy insight thành công' })
  async getInsights(@CurrentUser('id') userId: string) {
    return this.analyticsService.getInsights(userId);
  }
}
