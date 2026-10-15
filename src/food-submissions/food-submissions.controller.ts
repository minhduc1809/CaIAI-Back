import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FoodSubmissionsService } from './food-submissions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateFoodSubmissionDto {
  @ApiProperty({ description: 'Mã món tự tạo của bạn muốn gửi vào kho chung' })
  @IsString()
  @IsNotEmpty()
  customFoodId: string;

  @ApiPropertyOptional({ description: 'Ghi chú cho người duyệt (nguồn số liệu, nhãn sản phẩm...)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

@ApiTags('Food Submissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('foods/submissions')
export class FoodSubmissionsController {
  constructor(private readonly submissions: FoodSubmissionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Gửi món tự tạo vào kho chung để admin duyệt (BR-08.5)' })
  submit(@CurrentUser('id') userId: string, @Body() dto: CreateFoodSubmissionDto) {
    return this.submissions.submit(userId, dto.customFoodId, dto.note);
  }

  @Get()
  @ApiOperation({ summary: 'Các món tôi đã gửi và trạng thái duyệt' })
  listMine(@CurrentUser('id') userId: string) {
    return this.submissions.listMine(userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Huỷ việc gửi món khi còn chờ duyệt' })
  cancel(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.submissions.cancel(userId, id);
  }
}
