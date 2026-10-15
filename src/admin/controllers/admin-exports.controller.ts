import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminExportService } from '../services/admin-export.service';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin - Xuất dữ liệu')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/exports')
export class AdminExportsController {
  constructor(private readonly exportsService: AdminExportService) {}

  @Get(':kind/fields')
  @ApiOperation({ summary: 'Các trường được phép xuất của một loại dữ liệu' })
  fields(@Param('kind') kind: string) {
    return this.exportsService.fields(kind);
  }

  @Get(':kind/preview')
  @ApiOperation({ summary: 'Xem trước vài dòng đầu theo bộ lọc và trường đã chọn' })
  preview(@Param('kind') kind: string, @Query() query: Record<string, string | undefined>) {
    return this.exportsService.preview(kind, query);
  }

  @Get(':kind')
  @ApiOperation({ summary: 'Xuất CSV (users, orders, revenue, foods, exercises, audit, data-requests) theo đúng bộ lọc; ghi nhật ký' })
  async export(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('kind') kind: string,
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, name, truncated } = await this.exportsService.build({ id, email }, kind, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Truncated',
      'X-Export-Truncated': truncated ? 'true' : 'false',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }
}
