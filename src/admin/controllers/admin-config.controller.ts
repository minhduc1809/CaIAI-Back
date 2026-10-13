import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class SetConfigDto {
  @IsNotEmpty() value: number | boolean;
  @IsString() reason: string;
  @IsOptional() @IsString() password?: string;
}

export class ReasonDto {
  @IsString() reason: string;
  @IsOptional() @IsString() password?: string;
}

@ApiTags('Admin - Tham số hệ thống')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/config')
export class AdminConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Danh mục tham số: mặc định, giá trị hiện tại, giới hạn' })
  list() {
    return this.config.list();
  }

  @Get('history')
  @ApiOperation({ summary: 'Lịch sử thay đổi (lọc theo key)' })
  history(@Query('key') key?: string, @Query('limit') limit?: string) {
    return this.config.history(key, limit ? Number(limit) : undefined);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Sửa tham số (bắt buộc lý do ≥ 10 ký tự; tham số an toàn cần nhập lại mật khẩu)' })
  set(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('key') key: string,
    @Body() dto: SetConfigDto,
  ) {
    return this.config.set({ id, email }, key, dto.value, dto.reason, dto.password);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Về mặc định (xoá ghi đè), bắt buộc lý do' })
  reset(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('key') key: string,
    @Body() dto: ReasonDto,
  ) {
    return this.config.reset({ id, email }, key, dto.reason, dto.password);
  }

  @Post('restore/:historyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khôi phục giá trị trước một bản ghi lịch sử (là một lần sửa mới)' })
  restore(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('historyId') historyId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.config.restore({ id, email }, historyId, dto.reason, dto.password);
  }
}
