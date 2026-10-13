import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkoutCategory } from '@prisma/client';
import { WORKOUT_LIMITS } from '../workout-rules';
import { IsHalfStep } from './is-half-step.decorator';

export class CreateWorkoutSetDto {
  @ApiProperty({ example: 1, description: 'Thứ tự set tập' })
  @IsNumber({}, { message: 'setNumber phải là số' })
  @Min(1, { message: 'setNumber tối thiểu là 1' })
  setNumber: number;

  @ApiProperty({ example: 10, description: 'Số lần lặp (reps), 1–100' })
  @IsNumber({}, { message: 'reps phải là số' })
  @Min(1, { message: 'reps tối thiểu là 1' })
  @Max(WORKOUT_LIMITS.repsMax, { message: `reps tối đa là ${WORKOUT_LIMITS.repsMax}` })
  reps: number;

  @ApiProperty({ example: 60, description: 'Mức tạ (kg), 0–500; 0 là bài tạ cơ thể' })
  @IsNumber({}, { message: 'weightKg phải là số' })
  @Min(0, { message: 'weightKg không được âm' })
  @Max(WORKOUT_LIMITS.weightMaxKg, { message: `weightKg tối đa là ${WORKOUT_LIMITS.weightMaxKg}` })
  weightKg: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Chỉ số gắng sức RPE (1-10, bước 0,5)',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  @IsHalfStep({ message: 'RPE tính theo bước 0,5' })
  rpe?: number;

  @ApiPropertyOptional({ description: 'Set khởi động: không tính volume và kỷ lục' })
  @IsOptional()
  @IsBoolean()
  isWarmup?: boolean;

  @ApiPropertyOptional({ example: 45, description: 'Thời gian của set (giây), cho bài tính giờ' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(36000)
  durationSec?: number;

  @ApiPropertyOptional({ example: 1000, description: 'Quãng đường (mét), cho bài cardio' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  distanceM?: number;
}

export class CreateWorkoutExerciseDto {
  @ApiProperty({
    example: 'Bench Press (Đẩy ngực ngang)',
    description: 'Tên bài tập',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên bài tập không được để trống' })
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 1, description: 'Thứ tự bài tập trong buổi' })
  @IsOptional()
  @IsNumber()
  order?: number;

  @ApiPropertyOptional({ enum: ['CATALOG', 'CUSTOM'], description: 'Nguồn bài tập; bỏ trống nếu chỉ có tên' })
  @IsOptional()
  @IsIn(['CATALOG', 'CUSTOM'])
  exerciseSource?: 'CATALOG' | 'CUSTOM';

  @ApiPropertyOptional({ description: 'Mã bài trong kho hoặc bài tự tạo' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  exerciseId?: string;

  @ApiPropertyOptional({ example: 'Ngực', description: 'Nhóm cơ chính (để thống kê set theo nhóm cơ)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryMuscle?: string;

  @ApiPropertyOptional({ example: 90, description: 'Thời gian nghỉ giữa các set (giây)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(WORKOUT_LIMITS.restSecMax)
  restSec?: number;

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
    description:
      'Thời điểm diễn ra buổi tập (mặc định là hôm nay). Không được là ngày tương lai theo múi giờ người dùng.',
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiProperty({ example: 60, description: 'Thời lượng buổi tập (phút), 1–600' })
  @IsNumber({}, { message: 'Thời lượng phải là số' })
  @Min(1, { message: 'Thời lượng tối thiểu 1 phút' })
  @Max(WORKOUT_LIMITS.durationMaxMin, {
    message: `Thời lượng tối đa ${WORKOUT_LIMITS.durationMaxMin} phút (10 tiếng)`,
  })
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
    example: '0b8f0b7e-6d5f-4f3e-9a52-2f8f7f0c1a11',
    description:
      'Mã do app tạo lúc bấm Lưu. Gửi lại cùng mã (retry/offline) chỉ trả buổi đã có, không tạo thêm (BR-10.4).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;

  @ApiPropertyOptional({ description: 'Giờ bắt đầu phiên tập (ISO)' })
  @IsOptional()
  @IsString()
  startedAt?: string;

  @ApiPropertyOptional({ description: 'Giờ kết thúc phiên tập (ISO)' })
  @IsOptional()
  @IsString()
  endedAt?: string;

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
