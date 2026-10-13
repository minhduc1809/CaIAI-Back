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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkoutsService } from './workouts.service';
import { WorkoutsInsightsService } from './workouts-insights.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { UpdateWorkoutLogDto } from './dto/update-workout-log.dto';
import { QueryWorkoutDto } from './dto/query-workout.dto';

@ApiTags('Workouts')
@Controller('workouts')
export class WorkoutsController {
  constructor(
    private readonly workoutsService: WorkoutsService,
    private readonly insights: WorkoutsInsightsService,
  ) {}

  @Get('categories')
  @ApiOperation({
    summary: 'Lấy danh mục các bài tập và hệ số MET tham khảo',
    description:
      'Trả về danh sách 10 loại hình tập luyện phổ biến kèm hệ số MET chuẩn để tính calo tiêu hao.',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh mục thành công' })
  getCategories() {
    return this.workoutsService.getCategories();
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Tổng hợp vận động trong ngày (Active Calories, thời lượng, số buổi)',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-09-05',
    description: 'Ngày cần tra cứu (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Lấy tóm tắt vận động thành công' })
  getDailySummary(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
  ) {
    return this.workoutsService.getDailySummary(userId, date);
  }

  // ── Lịch sử, thống kê, kỷ lục (BR-10.8) và đối chiếu số buổi tập (BR-10.7). Khai báo TRƯỚC ":id". ──
  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lịch tháng: các ngày có tập và danh sách buổi tập trong tháng' })
  @ApiQuery({ name: 'month', required: false, example: '2026-10' })
  history(@CurrentUser('id') userId: string, @Query('month') month?: string) {
    return this.insights.history(userId, month);
  }

  @Get('exercise-history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Các lần tập một bài: ngày, set tốt nhất, volume' })
  @ApiQuery({ name: 'key', example: 'CATALOG:m-beg-01' })
  exerciseHistory(@CurrentUser('id') userId: string, @Query('key') key: string) {
    return this.insights.exerciseHistory(userId, key);
  }

  @Get('last-sets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Các set của lần tập gần nhất của bài, để app điền sẵn số lần và tạ' })
  @ApiQuery({ name: 'key', example: 'CATALOG:m-beg-01' })
  lastSets(@CurrentUser('id') userId: string, @Query('key') key: string) {
    return this.insights.lastSets(userId, key);
  }

  @Get('stats/volume')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Volume theo tuần (set không khởi động), lọc theo bài hoặc nhóm cơ chính' })
  volume(
    @CurrentUser('id') userId: string,
    @Query('weeks') weeks?: string,
    @Query('key') key?: string,
    @Query('muscle') muscle?: string,
  ) {
    return this.insights.volumeByWeek(userId, { weeks: weeks ? Number(weeks) : undefined, key, muscle });
  }

  @Get('stats/sets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Số set (không khởi động) theo nhóm cơ chính trong N tuần gần nhất' })
  sets(@CurrentUser('id') userId: string, @Query('weeks') weeks?: string) {
    return this.insights.setsPerMuscle(userId, weeks ? Number(weeks) : undefined);
  }

  @Get('records')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Kỷ lục cá nhân, gom theo bài' })
  @ApiQuery({ name: 'key', required: false })
  records(@CurrentUser('id') userId: string, @Query('key') key?: string) {
    return this.insights.records(userId, key);
  }

  @Get('last-template')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Buổi tập gần nhất dưới dạng khuôn để "Lặp lại buổi gần nhất"' })
  lastTemplate(@CurrentUser('id') userId: string) {
    return this.insights.lastWorkoutTemplate(userId);
  }

  @Get('activity-check')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Đối chiếu số buổi tập thực tế 4 tuần gần nhất với khai báo (chỉ đề xuất, không tự đổi)' })
  activityCheck(@CurrentUser('id') userId: string) {
    return this.insights.activityCheck(userId);
  }

  @Post('activity-check/handled')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Ghi nhận đã xử lý đề xuất (đồng ý hoặc bỏ qua) để không hỏi lại ngay' })
  activityCheckHandled(@CurrentUser('id') userId: string) {
    return this.insights.markActivityCheckHandled(userId);
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
  createWorkout(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkoutLogDto,
  ) {
    return this.workoutsService.createWorkout(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lấy danh sách các buổi tập của người dùng',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  getWorkouts(
    @CurrentUser('id') userId: string,
    @Query() query: QueryWorkoutDto,
  ) {
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
