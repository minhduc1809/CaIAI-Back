import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkoutRoutinesService } from './workout-routines.service';
import {
  CreateCustomExerciseDto,
  CreateRoutineDto,
  RoutineFromWorkoutDto,
  UpdateRoutineDto,
} from './dto/workout-routine.dto';

@ApiTags('Workout routines')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class WorkoutRoutinesController {
  constructor(private readonly routines: WorkoutRoutinesService) {}

  @Get('workout-routines')
  @ApiOperation({ summary: 'Danh sách buổi tập mẫu của tôi' })
  list(@CurrentUser('id') userId: string) {
    return this.routines.list(userId);
  }

  @Post('workout-routines')
  @ApiOperation({ summary: 'Tạo buổi tập mẫu' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateRoutineDto) {
    return this.routines.create(userId, dto);
  }

  @Post('workout-routines/from-workout/:workoutId')
  @ApiOperation({ summary: 'Lưu một buổi đã tập thành buổi tập mẫu' })
  fromWorkout(
    @CurrentUser('id') userId: string,
    @Param('workoutId') workoutId: string,
    @Body() dto: RoutineFromWorkoutDto,
  ) {
    return this.routines.createFromWorkout(userId, workoutId, dto.name);
  }

  @Patch('workout-routines/:id')
  @ApiOperation({ summary: 'Sửa buổi tập mẫu (không ảnh hưởng buổi đã ghi)' })
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateRoutineDto) {
    return this.routines.update(userId, id, dto);
  }

  @Delete('workout-routines/:id')
  @ApiOperation({ summary: 'Xoá buổi tập mẫu' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.routines.remove(userId, id);
  }

  @Get('custom-exercises')
  @ApiOperation({ summary: 'Bài tập do tôi tự tạo' })
  listCustom(@CurrentUser('id') userId: string) {
    return this.routines.listCustomExercises(userId);
  }

  @Post('custom-exercises')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo bài tập riêng (chỉ mình tôi thấy)' })
  createCustom(@CurrentUser('id') userId: string, @Body() dto: CreateCustomExerciseDto) {
    return this.routines.createCustomExercise(userId, dto);
  }

  @Delete('custom-exercises/:id')
  @ApiOperation({ summary: 'Xoá bài tập riêng (buổi đã ghi giữ nguyên số liệu)' })
  removeCustom(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.routines.removeCustomExercise(userId, id);
  }
}
