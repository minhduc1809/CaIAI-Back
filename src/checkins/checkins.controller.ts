import {
  Controller,
  Post,
  Get,
  Patch,
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
import { CheckinsService } from './checkins.service';
import { CreateCheckinDto } from './dto/create-checkin.dto';
import { RespondCheckinDto } from './dto/respond-checkin.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Check-ins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('checkins')
export class CheckinsController {
  constructor(private readonly checkinsService: CheckinsService) {}

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo/trigger check-in tuần hiện tại (Coached/Collaborative)',
  })
  @ApiResponse({
    status: 201,
    description: 'Check-in được tạo thành công với đề xuất điều chỉnh mục tiêu',
  })
  async generateCheckin(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCheckinDto,
  ) {
    return this.checkinsService.generateCheckin(userId, dto);
  }

  @Get('pending')
  @ApiOperation({
    summary:
      'Lấy check-in đang chờ xử lý (PENDING hoặc DISMISSED) cùng coaching module',
  })
  @ApiResponse({
    status: 200,
    description: 'Check-in đang chờ hoặc null nếu không có',
  })
  async getPendingCheckin(@CurrentUser('id') userId: string) {
    return this.checkinsService.getPendingCheckin(userId);
  }

  @Patch(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Phản hồi check-in: Accept (áp target mới) / Decline (giữ nguyên) / Dismiss (hoãn lại)',
  })
  @ApiResponse({ status: 200, description: 'Phản hồi check-in thành công' })
  async respondToCheckin(
    @CurrentUser('id') userId: string,
    @Param('id') checkinId: string,
    @Body() dto: RespondCheckinDto,
  ) {
    return this.checkinsService.respondToCheckin(userId, checkinId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lịch sử check-in của người dùng' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Danh sách check-in theo thứ tự mới nhất',
  })
  async getCheckinHistory(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
  ) {
    return this.checkinsService.getCheckinHistory(
      userId,
      limit ? Number(limit) : 10,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một check-in kèm coaching module' })
  @ApiResponse({ status: 200, description: 'Chi tiết check-in' })
  async getCheckinById(
    @CurrentUser('id') userId: string,
    @Param('id') checkinId: string,
  ) {
    return this.checkinsService.getCheckinById(userId, checkinId);
  }
}
