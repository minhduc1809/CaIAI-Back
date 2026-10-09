import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MealPlanService } from './meal-plan.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Meal Plan')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('meal-plan')
export class MealPlanController {
  constructor(private readonly mealPlan: MealPlanService) {}

  @Get('today')
  @ApiOperation({
    summary: 'Thực đơn hôm nay từ kho món an toàn, kèm trạng thái đã ăn / chưa ăn và đề xuất cho phần còn lại',
  })
  today(@CurrentUser('id') userId: string) {
    return this.mealPlan.getToday(userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Kế hoạch dinh dưỡng 7 hoặc 30 ngày. Free xem đủ 7 ngày và xem trước 7 ngày đầu của 30 ngày',
  })
  @ApiQuery({ name: 'days', required: false, enum: [7, 30] })
  plan(@CurrentUser('id') userId: string, @Query('days') days?: string) {
    const n = days === undefined ? 7 : Number(days);
    if (n !== 7 && n !== 30) throw new BadRequestException('days chỉ nhận 7 hoặc 30');
    return this.mealPlan.getPlan(userId, n);
  }
}
