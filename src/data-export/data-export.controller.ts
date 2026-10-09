import { Controller, HttpCode, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataExportService } from './data-export.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Quyền dữ liệu')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('me')
export class DataExportController {
  constructor(private readonly exporter: DataExportService) {}

  @Post('export')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Xuất toàn bộ dữ liệu của tôi (ZIP gồm JSON và CSV)',
    description:
      'Luôn dùng được ở mọi gói. Tối đa một lần mỗi ngày (theo múi giờ của người dùng), vượt thì trả 429 QUOTA_EXCEEDED. ' +
      'Trả trực tiếp file ZIP; không bọc trong JSON.',
  })
  async export(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.exporter.exportUserData(userId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(result.buffer.length),
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(result.buffer);
  }
}
