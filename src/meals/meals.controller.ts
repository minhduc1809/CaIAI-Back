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
import { MealsService } from './meals.service';
import { CreateMealDto } from './dto/create-meal.dto';
import { UpdateMealDto } from './dto/update-meal.dto';
import { QuickAddMealDto } from './dto/quick-add-meal.dto';
import { CopyMealDto } from './dto/copy-meal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MealType } from '@prisma/client';

@ApiTags('Meals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('meals')
export class MealsController {
  constructor(private readonly mealsService: MealsService) {}

  @Get('frequent')
  @ApiOperation({
    summary:
      'Lấy danh sách món quen (tối đa 20 món ăn thường dùng nhất trong 30 ngày gần đây - BR-07.7)',
  })
  @ApiQuery({
    name: 'mealType',
    required: false,
    enum: MealType,
    description: 'Lọc theo loại bữa ăn (BREAKFAST, LUNCH, DINNER, SNACK)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy danh sách món quen thành công',
  })
  async getFrequentFoods(
    @CurrentUser('id') userId: string,
    @Query('mealType') mealType?: MealType,
  ) {
    return this.mealsService.getFrequentFoods(userId, mealType);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ghi nhận bữa ăn mới (hỗ trợ nhiều món ăn trong 1 bữa)',
  })
  @ApiResponse({ status: 201, description: 'Tạo bữa ăn thành công' })
  async createMeal(
    @CurrentUser('id') userId: string,
    @Body() createMealDto: CreateMealDto,
  ) {
    return this.mealsService.createMeal(userId, createMealDto);
  }

  @Post('quick-add')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ghi nhận calo/macro nhanh (không cần chọn từng món con)',
  })
  @ApiResponse({ status: 201, description: 'Ghi nhận calo nhanh thành công' })
  async quickAddMeal(
    @CurrentUser('id') userId: string,
    @Body() dto: QuickAddMealDto,
  ) {
    return this.mealsService.quickAddMeal(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách các bữa ăn theo ngày' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-08-19',
    description: 'Ngày cần xem (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getMeals(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
  ) {
    return this.mealsService.getMealsByDate(userId, date);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Thống kê tổng lượng Calo & Macros đã nạp trong ngày vs Mục tiêu',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-08-19',
    description: 'Ngày cần xem (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Lấy thống kê thành công' })
  async getDailySummary(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
  ) {
    return this.mealsService.getDailyNutritionSummary(userId, date);
  }

  @Get('week-summary')
  @ApiOperation({
    summary:
      'Tóm tắt 7 ngày liên tiếp từ startDate — calo đã nạp + đã đạt mục tiêu hay chưa từng ngày (dùng cho Week Strip)',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    example: '2026-09-28',
    description:
      'Ngày đầu tuần (YYYY-MM-DD), trả về đúng 7 ngày kể từ ngày này',
  })
  @ApiResponse({ status: 200, description: 'Lấy tóm tắt tuần thành công' })
  async getWeekSummary(
    @CurrentUser('id') userId: string,
    @Query('startDate') startDate: string,
  ) {
    return this.mealsService.getWeekSummary(userId, startDate);
  }

  @Get('statistics')
  @ApiOperation({
    summary:
      'Thống kê dinh dưỡng theo dải ngày hoặc theo preset (mặc định 7 ngày gần nhất)',
  })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-08-13' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-08-19' })
  @ApiQuery({
    name: 'preset',
    required: false,
    enum: ['week', 'month', 'quarter', 'year', 'all'],
    description: 'Bỏ qua nếu đã truyền startDate/endDate tường minh',
  })
  @ApiResponse({ status: 200, description: 'Lấy thống kê thành công' })
  async getStatistics(
    @CurrentUser('id') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('preset') preset?: 'week' | 'month' | 'quarter' | 'year' | 'all',
  ) {
    return this.mealsService.getNutritionStatistics(
      userId,
      startDate,
      endDate,
      preset,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết của 1 bữa ăn' })
  @ApiResponse({ status: 200, description: 'Lấy chi tiết thành công' })
  async getMealDetail(
    @CurrentUser('id') userId: string,
    @Param('id') mealId: string,
  ) {
    return this.mealsService.getMealDetail(userId, mealId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật bữa ăn (sửa loại bữa, ngày hoặc danh sách món ăn)',
  })
  @ApiResponse({ status: 200, description: 'Cập nhật bữa ăn thành công' })
  async updateMeal(
    @CurrentUser('id') userId: string,
    @Param('id') mealId: string,
    @Body() updateMealDto: UpdateMealDto,
  ) {
    return this.mealsService.updateMeal(userId, mealId, updateMealDto);
  }

  @Post(':id/copy')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Sao chép bữa ăn sang một ngày khác (Copy meal)' })
  @ApiResponse({ status: 201, description: 'Sao chép bữa ăn thành công' })
  async copyMeal(
    @CurrentUser('id') userId: string,
    @Param('id') mealId: string,
    @Body() copyMealDto: CopyMealDto,
  ) {
    return this.mealsService.copyMeal(userId, mealId, copyMealDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa bữa ăn' })
  @ApiResponse({ status: 200, description: 'Xóa bữa ăn thành công' })
  async deleteMeal(
    @CurrentUser('id') userId: string,
    @Param('id') mealId: string,
  ) {
    return this.mealsService.deleteMeal(userId, mealId);
  }
}
