import { IsNotEmpty, IsString } from 'class-validator';
import { AdminFoodImportService } from '../services/admin-food-import.service';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminFoodsService } from '../services/admin-foods.service';
import { AdminCreateFoodDto, AdminUpdateFoodDto } from '../dto/admin-food.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class ImportFoodsCsvDto {
  @IsString()
  @IsNotEmpty()
  csv: string;
}

@ApiTags('Admin - Kho món')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/foods')
export class AdminFoodsController {
  constructor(
    private readonly foods: AdminFoodsService,
    private readonly importer: AdminFoodImportService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: 'Các nhóm món kèm số món (dựng bộ lọc)' })
  categories() {
    return this.foods.categories();
  }

  @Get('progress')
  @ApiOperation({ summary: 'Tiến độ kho món: số món hiển thị, đã gắn thẻ an toàn, cần rà soát (so với mục tiêu)' })
  progress() {
    return this.foods.progress();
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách món: tìm không dấu, lọc nhóm/nguồn/thiếu thẻ/cần rà soát/trạng thái, sắp xếp, phân trang' })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiQuery({ name: 'source', required: false, enum: ['OFFICIAL', 'COMMUNITY'] })
  @ApiQuery({ name: 'missingTags', required: false, type: Boolean })
  @ApiQuery({ name: 'needsReview', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'calories', 'category', 'createdAt'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @Query('query') query?: string,
    @Query('category') category?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('missingTags') missingTags?: string,
    @Query('needsReview') needsReview?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.foods.list({
      query,
      category,
      includeInactive: includeInactive === 'true',
      status,
      source,
      missingTags: missingTags === 'true',
      needsReview: needsReview === 'true',
      sort,
      order,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhập kho món bằng CSV, bước 1: xem trước và báo lỗi từng dòng (chưa ghi gì)' })
  importPreview(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Body() dto: ImportFoodsCsvDto,
  ) {
    return this.importer.preview({ id: adminId, email: adminEmail }, dto.csv);
  }

  @Post('import/:importId/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhập kho món bằng CSV, bước 2: xác nhận ghi các dòng hợp lệ' })
  importCommit(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('importId') importId: string,
  ) {
    return this.importer.commit({ id: adminId, email: adminEmail }, importId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Thêm món vào kho (bắt buộc khai báo đủ thẻ an toàn và nguồn số liệu)' })
  @ApiResponse({ status: 201, description: 'Đã thêm; kèm cảnh báo mềm nếu calo lệch Atwater' })
  create(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Body() dto: AdminCreateFoodDto,
  ) {
    return this.foods.create({ id: adminId, email: adminEmail }, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa món trong kho (sửa thẻ an toàn thì phải gửi đủ bộ)' })
  update(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') id: string,
    @Body() dto: AdminUpdateFoodDto,
  ) {
    return this.foods.update({ id: adminId, email: adminEmail }, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Ẩn món khỏi kho (không xoá hẳn để giữ lịch sử)' })
  deactivate(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Param('id') id: string,
  ) {
    return this.foods.deactivate({ id: adminId, email: adminEmail }, id);
  }
}
