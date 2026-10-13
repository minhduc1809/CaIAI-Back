import { IsNotEmpty, IsString } from 'class-validator';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminExercisesService } from '../services/admin-exercises.service';
import { AdminCreateExerciseDto, AdminUpdateExerciseDto } from '../dto/admin-exercise.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

export class ImportExercisesDto {
  @IsString()
  @IsNotEmpty()
  csv: string;
}

@ApiTags('Admin - Kho bài tập')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/exercises')
export class AdminExercisesController {
  constructor(private readonly exercises: AdminExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách bài tập: tìm không dấu, lọc mức độ/nhóm cơ/dụng cụ/giới/trạng thái, sắp xếp, phân trang' })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'level', required: false })
  @ApiQuery({ name: 'muscle', required: false })
  @ApiQuery({ name: 'equipment', required: false })
  @ApiQuery({ name: 'gender', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'level', 'targetMuscle', 'createdAt'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  list(
    @Query('query') query?: string,
    @Query('level') level?: string,
    @Query('muscle') muscle?: string,
    @Query('equipment') equipment?: string,
    @Query('gender') gender?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.exercises.list({
      query, level, muscle, equipment, gender, status, sort, order,
      includeInactive: includeInactive === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhập kho bài tập bằng CSV, bước 1: kiểm tra từng dòng, chưa ghi gì' })
  importPreview(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Body() dto: ImportExercisesDto) {
    return this.exercises.importPreview({ id, email }, dto.csv);
  }

  @Post('import/:importId/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhập kho bài tập bằng CSV, bước 2: xác nhận ghi các dòng hợp lệ' })
  importCommit(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Param('importId') importId: string) {
    return this.exercises.importCommit({ id, email }, importId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Thêm bài tập vào kho' })
  create(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Body() dto: AdminCreateExerciseDto) {
    return this.exercises.create({ id, email }, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa bài tập (hoặc ẩn/hiện bằng isActive)' })
  update(
    @CurrentUser('id') id: string,
    @CurrentUser('email') email: string,
    @Param('id') exerciseId: string,
    @Body() dto: AdminUpdateExerciseDto,
  ) {
    return this.exercises.update({ id, email }, exerciseId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Ẩn bài tập (không xoá cứng)' })
  hide(@CurrentUser('id') id: string, @CurrentUser('email') email: string, @Param('id') exerciseId: string) {
    return this.exercises.deactivate({ id, email }, exerciseId);
  }
}
