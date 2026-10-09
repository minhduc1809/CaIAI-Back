import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WaterLogsService } from './water-logs.service';
import { CreateWaterLogDto } from './dto/create-water-log.dto';

@ApiTags('Water Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('water-logs')
export class WaterLogsController {
  constructor(private readonly service: WaterLogsService) {}

  @Get('today')
  @ApiOperation({
    summary: 'Tổng lượng nước đã uống hôm nay + mục tiêu theo cân nặng',
  })
  getToday(@CurrentUser('id') userId: string) {
    return this.service.getToday(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ghi nhận 1 lần uống nước (mặc định 1 ly 250ml)' })
  add(@CurrentUser('id') userId: string, @Body() dto: CreateWaterLogDto) {
    return this.service.add(userId, dto.amountMl);
  }

  @Delete('last')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hoàn tác lần uống nước gần nhất hôm nay' })
  undoLast(@CurrentUser('id') userId: string) {
    return this.service.undoLast(userId);
  }
}
