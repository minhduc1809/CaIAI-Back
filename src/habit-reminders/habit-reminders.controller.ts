import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HabitRemindersService } from './habit-reminders.service';
import { CreateHabitReminderDto } from './dto/create-habit-reminder.dto';
import { UpdateHabitReminderDto } from './dto/update-habit-reminder.dto';
import { AttachHabitReminderFoodDto } from './dto/attach-food.dto';

@ApiTags('Habit Reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('habit-reminders')
export class HabitRemindersController {
  constructor(private readonly service: HabitRemindersService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách nhắc nhở bữa ăn/uống nước (tự seed 5 mặc định lần đầu)',
  })
  list(@CurrentUser('id') userId: string) {
    return this.service.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo nhắc nhở tuỳ chỉnh mới' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateHabitReminderDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cập nhật nhắc nhở (giờ, mục tiêu calo, lặp lại...)',
  })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHabitReminderDto,
  ) {
    return this.service.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xoá nhắc nhở tuỳ chỉnh (không xoá được nhắc mặc định)',
  })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }

  @Post(':id/foods')
  @ApiOperation({ summary: 'Gắn 1 món ăn cụ thể vào nhắc nhở' })
  addFood(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: AttachHabitReminderFoodDto,
  ) {
    return this.service.addFood(userId, id, dto);
  }

  @Delete(':id/foods/:foodId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gỡ 1 món ăn đã gắn khỏi nhắc nhở' })
  removeFood(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('foodId') foodId: string,
  ) {
    return this.service.removeFood(userId, id, foodId);
  }

  @Get(':id/suggestions')
  @ApiOperation({
    summary:
      'Gợi ý món Eat Clean lấp đầy đúng mục tiêu calo của riêng nhắc nhở này',
  })
  suggestFoods(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.suggestFoods(userId, id);
  }
}
