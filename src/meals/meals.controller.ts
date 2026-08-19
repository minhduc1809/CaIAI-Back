import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MealsService } from './meals.service';
import { CreateMealDto } from './dto/create-meal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Meals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('meals')
export class MealsController {
  constructor(private readonly mealsService: MealsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ghi nhận bữa ăn mới (hỗ trợ nhiều món ăn trong 1 bữa)' })
  @ApiResponse({ status: 201, description: 'Tạo bữa ăn thành công' })
  async createMeal(
    @CurrentUser('id') userId: string,
    @Body() createMealDto: CreateMealDto,
  ) {
    return this.mealsService.createMeal(userId, createMealDto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách các bữa ăn theo ngày' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-19', description: 'Ngày cần xem (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách thành công' })
  async getMeals(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
  ) {
    return this.mealsService.getMealsByDate(userId, date);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Thống kê tổng lượng Calo & Macros đã nạp trong ngày vs Mục tiêu' })
  @ApiQuery({ name: 'date', required: false, example: '2026-08-19', description: 'Ngày cần xem (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Lấy thống kê thành công' })
  async getDailySummary(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
  ) {
    return this.mealsService.getDailyNutritionSummary(userId, date);
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
