import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkoutCategory } from '@prisma/client';

export class CreateWorkoutSetDto {
  @ApiProperty({ example: 1, description: 'Thứ tự set tập' })
  @IsNumber({}, { message: 'setNumber phải là số' })
  @Min(1, { message: 'setNumber tối thiểu là 1' })
  setNumber: number;

  @ApiProperty({ example: 10, description: 'Số lần lặp (reps)' })
  @IsNumber({}, { message: 'reps phải là số' })
  @Min(1, { message: 'reps tối thiểu là 1' })
  reps: number;

  @ApiProperty({ example: 60, description: 'Mức tạ (kg)' })
  @IsNumber({}, { message: 'weightKg phải là số' })
  @Min(0, { message: 'weightKg không được âm' })
  weightKg: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Chỉ số gắng sức RPE (1-10)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  rpe?: number;
}

export class CreateWorkoutExerciseDto {
  @ApiProperty({
    example: 'Bench Press (Đẩy ngực ngang)',
    description: 'Tên bài tập',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên bài tập không được để trống' })
  name: string;

  @ApiPropertyOptional({ example: 1, description: 'Thứ tự bài tập trong buổi' })
  @IsOptional()
  @IsNumber()
  order?: number;

  @ApiProperty({
    type: [CreateWorkoutSetDto],
    description: 'Danh sách các set của bài tập',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutSetDto)
  sets: CreateWorkoutSetDto[];
}

export class CreateWorkoutLogDto {
  @ApiProperty({
    example: 'Buổi tập ngực & tay sau',
    description: 'Tên buổi tập / hoạt động',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên buổi tập không được để trống' })
  name: string;

  @ApiProperty({
    enum: WorkoutCategory,
    example: WorkoutCategory.STRENGTH,
    description:
      'Phân loại tập luyện (STRENGTH, CARDIO, RUNNING, CYCLING, SWIMMING, HIIT, WALKING, YOGA, SPORTS, OTHER)',
  })
  @IsEnum(WorkoutCategory, { message: 'Phân loại bài tập không hợp lệ' })
  category: WorkoutCategory;

  @ApiPropertyOptional({
    example: '2026-09-05T08:00:00.000Z',
    description: 'Thời điểm diễn ra buổi tập (mặc định là thời điểm hiện tại)',
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiProperty({ example: 60, description: 'Thời lượng buổi tập (phút)' })
  @IsNumber({}, { message: 'Thời lượng phải là số' })
  @Min(1, { message: 'Thời lượng tối thiểu 1 phút' })
  @Max(720, { message: 'Thời lượng tối đa 720 phút (12 tiếng)' })
  durationMinutes: number;

  @ApiPropertyOptional({
    example: 350,
    description:
      'Lượng calo tiêu hao (kcal). Nếu bỏ trống, hệ thống sẽ tự động tính theo hệ số MET chuẩn.',
  })
  @IsOptional()
  @IsNumber({}, { message: 'caloriesBurned phải là số' })
  @Min(0, { message: 'caloriesBurned không được âm' })
  caloriesBurned?: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Độ gắng sức toàn buổi RPE (1-10)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'RPE tối thiểu 1' })
  @Max(10, { message: 'RPE tối đa 10' })
  rpe?: number;

  @ApiPropertyOptional({
    example: 'Hôm nay đẩy ngực lên tạ mới rất tốt',
    description: 'Ghi chú buổi tập',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    type: [CreateWorkoutExerciseDto],
    description: 'Danh sách bài tập và sets chi tiết (cho Gym / Kháng lực)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutExerciseDto)
  exercises?: CreateWorkoutExerciseDto[];
}
