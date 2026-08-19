import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { RecommendationsService } from './recommendations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Recommendations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('foods/categories')
  @ApiOperation({ summary: 'Lấy danh mục các nhóm món ăn (Cơm, Bún phở, Thịt gà, Bò, Cá, Rau canh, Trái cây)' })
  @ApiResponse({ status: 200, description: 'Lấy danh mục thành công' })
  async getFoodCategories() {
    return this.recommendationsService.getFoodCategories();
  }

  @Get('foods')
  @ApiOperation({ summary: 'Tra cứu danh sách hơn 120+ món ăn Việt Nam chuẩn Calo & Macros' })
  @ApiQuery({ name: 'q', required: false, description: 'Từ khóa tìm kiếm (VD: phở, gà, bò, cá lóc...)' })
  @ApiQuery({ name: 'category', required: false, description: 'Lọc theo nhóm món (VD: "Cơm - Tinh bột", "Bún - Phở - Mì", "Hải sản - Cá"...)' })
  @ApiResponse({ status: 200, description: 'Tra cứu món ăn thành công' })
  async searchFoods(
    @Query('q') query?: string,
    @Query('category') category?: string,
  ) {
    return this.recommendationsService.searchFoodItems(query, category);
  }

  @Get('diet')
  @ApiOperation({ summary: 'Gợi ý thực đơn món ăn Việt Nam chuẩn Calo & Macros' })
  @ApiResponse({ status: 200, description: 'Gợi ý thực đơn thành công' })
  async getDietRecommendation(@CurrentUser('id') userId: string) {
    return this.recommendationsService.getDietRecommendation(userId);
  }

  @Get('diet/monthly')
  @ApiOperation({ summary: 'Lấy Thực đơn 30 ngày chia theo Goal (LOSE_WEIGHT / GAIN_WEIGHT) và Level người tập (BEGINNER / INTERMEDIATE / ADVANCED)' })
  @ApiQuery({ name: 'day', required: false, example: 1, description: 'Số ngày trong tháng (1 đến 30)' })
  @ApiQuery({ name: 'goal', required: false, enum: ['LOSE_WEIGHT', 'MAINTAIN', 'GAIN_WEIGHT'], description: 'Mục tiêu dinh dưỡng' })
  @ApiQuery({ name: 'level', required: false, enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'], description: 'Cấp độ tập luyện / Kinh nghiệm' })
  @ApiResponse({ status: 200, description: 'Lấy thực đơn 30 ngày thành công' })
  async getMonthlyDiet(
    @CurrentUser('id') userId: string,
    @Query('day') day?: number,
    @Query('goal') goal?: string,
    @Query('level') level?: string,
  ) {
    return this.recommendationsService.getMonthlyDietPlans(userId, day, goal, level);
  }

  @Get('workout')
  @ApiOperation({ summary: 'Gợi ý lộ trình bài tập theo tuần phù hợp với thể trạng BMI & Mục tiêu' })
  @ApiResponse({ status: 200, description: 'Gợi ý bài tập thành công' })
  async getWorkoutRecommendation(@CurrentUser('id') userId: string) {
    return this.recommendationsService.getWorkoutRecommendation(userId);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Lấy trọn bộ gói gợi ý cá nhân hóa (Thực đơn + Lộ trình bài tập)' })
  @ApiResponse({ status: 200, description: 'Lấy tổng quan gợi ý thành công' })
  async getOverview(@CurrentUser('id') userId: string) {
    return this.recommendationsService.getRecommendationsOverview(userId);
  }

  @Get('exercises')
  @ApiOperation({ summary: 'Lấy danh sách 50 bài tập theo Giới tính (MALE / FEMALE) và Cấp độ (BEGINNER / INTERMEDIATE / ADVANCED)' })
  @ApiResponse({ status: 200, description: 'Lấy danh sách bài tập thành công' })
  async getGenderExercises(
    @CurrentUser('id') userId: string,
    @Query('gender') gender?: string,
    @Query('level') level?: string,
  ) {
    return this.recommendationsService.getGenderExercises(userId, gender, level);
  }

  @Get('exercises/:id')
  @ApiOperation({ summary: 'Xem chi tiết hướng dẫn thực hiện, lỗi sai và cách hít thở của 1 bài tập' })
  @ApiResponse({ status: 200, description: 'Lấy chi tiết thành công' })
  async getExerciseDetail(@Param('id') exerciseId: string) {
    return this.recommendationsService.getExerciseDetail(exerciseId);
  }
}
