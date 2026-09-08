import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
  ApiQuery,
} from '@nestjs/swagger';
import { WeightLogsService } from './weight-logs.service';
import { CreateWeightLogDto } from './dto/create-weight-log.dto';
import { UpdateWeightLogDto } from './dto/update-weight-log.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Weight Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('weight-logs')
export class WeightLogsController {
  constructor(private readonly weightLogsService: WeightLogsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ghi nhận cân nặng mới (tự động cập nhật lại BMI/BMR/TDEE)',
  })
  @ApiResponse({ status: 201, description: 'Ghi nhận cân nặng thành công' })
  async createLog(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWeightLogDto,
  ) {
    return this.weightLogsService.createLog(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy lịch sử biến động cân nặng theo thời gian' })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 30,
    description: 'Số lượng bản ghi tối đa',
  })
  @ApiResponse({ status: 200, description: 'Lấy lịch sử thành công' })
  async getLogs(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
  ) {
    return this.weightLogsService.getLogs(userId, limit ? Number(limit) : 30);
  }

  @Get('trend')
  @ApiOperation({
    summary:
      'Lấy xu hướng cân nặng làm mượt (Trend Weight - EWMA) để loại bỏ biến động nước',
  })
  @ApiQuery({ name: 'limit', required: false, example: 60 })
  @ApiResponse({ status: 200, description: 'Lấy xu hướng cân nặng thành công' })
  async getWeightTrend(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
  ) {
    return this.weightLogsService.getWeightTrend(
      userId,
      limit ? Number(limit) : 60,
    );
  }

  @Get('progress')
  @ApiOperation({
    summary:
      'Thống kê tiến độ hoàn thành mục tiêu cân nặng (Start vs Current vs Target)',
  })
  @ApiResponse({ status: 200, description: 'Lấy tiến độ thành công' })
  async getWeightProgress(@CurrentUser('id') userId: string) {
    return this.weightLogsService.getWeightProgress(userId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật bản ghi cân nặng' })
  @ApiResponse({ status: 200, description: 'Cập nhật cân nặng thành công' })
  async updateLog(
    @CurrentUser('id') userId: string,
    @Param('id') logId: string,
    @Body() dto: UpdateWeightLogDto,
  ) {
    return this.weightLogsService.updateLog(userId, logId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa bản ghi cân nặng' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteLog(
    @CurrentUser('id') userId: string,
    @Param('id') logId: string,
  ) {
    return this.weightLogsService.deleteLog(userId, logId);
  }
}
