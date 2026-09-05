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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { UpdateWorkoutLogDto } from './dto/update-workout-log.dto';
import { QueryWorkoutDto } from './dto/query-workout.dto';

@ApiTags('Workouts')
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('categories')
  @ApiOperation({
    summary: 'Lấy danh mục các bài tập và hệ số MET tham khảo',
    description: 'Trả về danh sách 10 loại hình tập luyện phổ biến kèm hệ số MET chuẩn để tính calo tiêu hao.',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh mục thành công' })
  getCategories() {
    return this.workoutsService.getCategories();
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Tổng hợp vận động trong ngày (Active Calories, thời lượng, số buổi)',
  })
  @ApiQuery({ name: 'date', required: false, example: '2026-09-05', description: 'Ngày cần tra cứu (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Lấy tóm tắt vận động thành công' })
  getDailySummary(@CurrentUser('id') userId: string, @Query('date') date?: string) {
    return this.workoutsService.getDailySummary(userId, date);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Ghi nhận một buổi tập mới',
    description:
      'Ghi nhận buổi tập kèm bài tập chi tiết và sets. Nếu không truyền caloriesBurned, hệ thống sẽ tự động tính dựa trên hệ số MET và cân nặng hiện tại của người dùng.',
  })
  @ApiResponse({ status: 201, description: 'Tạo buổi tập thành công' })
  createWorkout(@CurrentUser('id') userId: string, @Body() dto: CreateWorkoutLogDto) {
    return this.workoutsService.createWorkout(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lấy danh sách các buổi tập của người dùng',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  getWorkouts(@CurrentUser('id') userId: string, @Query() query: QueryWorkoutDto) {
    return this.workoutsService.getWorkouts(userId, query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lấy chi tiết một buổi tập',
  })
  @ApiResponse({ status: 200, description: 'Lấy chi tiết thành công' })
  getWorkoutById(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.workoutsService.getWorkoutById(userId, id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Cập nhật thông tin buổi tập',
  })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  updateWorkout(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkoutLogDto,
  ) {
    return this.workoutsService.updateWorkout(userId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xóa một buổi tập',
  })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  deleteWorkout(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.workoutsService.deleteWorkout(userId, id);
  }
}
