import { MealsService } from '../meals/meals.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DailyStatusService } from './daily-status.service';
import { SetDailyStatusDto } from './dto/set-daily-status.dto';

@ApiTags('Daily status')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('daily-status')
export class DailyStatusController {
  constructor(
    private readonly service: DailyStatusService,
    private readonly mealsService: MealsService,
  ) {}

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Đánh giá ngày hôm qua và gửi thông báo DAY_COMPLETED nếu đạt (app gọi một lần khi mở app, BR-13.1)',
  })
  evaluate(@CurrentUser('id') userId: string) {
    return this.mealsService.evaluateYesterday(userId);
  }

  @Put(':date')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Đánh dấu một ngày là "Đã ghi đủ" / "Ghi chưa đủ" / để hệ thống quyết định (BR-05.2)',
  })
  @ApiResponse({ status: 200, description: 'Đã cập nhật trạng thái ngày' })
  @ApiResponse({
    status: 400,
    description: 'Ngày không hợp lệ hoặc ở tương lai',
  })
  setStatus(
    @CurrentUser('id') userId: string,
    @Param('date') date: string,
    @Body() dto: SetDailyStatusDto,
  ) {
    return this.service.setStatus(userId, date, dto.completeness);
  }

  @Get()
  @ApiOperation({ summary: 'Trạng thái "đầy đủ" của các ngày trong khoảng' })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-07' })
  listStatuses(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listStatuses(userId, from, to);
  }
}
