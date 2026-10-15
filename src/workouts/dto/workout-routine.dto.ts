import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkoutCategory } from '@prisma/client';
import { WORKOUT_LIMITS } from '../workout-rules';

export class RoutineSetDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) setNumber?: number;
  @ApiProperty() @IsNumber() @Min(1) @Max(WORKOUT_LIMITS.repsMax) reps: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(WORKOUT_LIMITS.weightMaxKg) weightKg: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isWarmup?: boolean;
}

export class RoutineItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiPropertyOptional({ enum: ['CATALOG', 'CUSTOM'] }) @IsOptional() @IsIn(['CATALOG', 'CUSTOM']) exerciseSource?: 'CATALOG' | 'CUSTOM';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) exerciseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) primaryMuscle?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(WORKOUT_LIMITS.restSecMax) restSec?: number;

  @ApiProperty({ type: [RoutineSetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RoutineSetDto)
  sets: RoutineSetDto[];
}

export class CreateRoutineDto {
  @ApiProperty({ example: 'Push day' }) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @ApiPropertyOptional({ enum: WorkoutCategory }) @IsOptional() @IsEnum(WorkoutCategory) category?: WorkoutCategory;

  @ApiProperty({ type: [RoutineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RoutineItemDto)
  items: RoutineItemDto[];
}

export class UpdateRoutineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @ApiPropertyOptional({ enum: WorkoutCategory }) @IsOptional() @IsEnum(WorkoutCategory) category?: WorkoutCategory;

  @ApiPropertyOptional({ type: [RoutineItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RoutineItemDto)
  items?: RoutineItemDto[];
}

export class RoutineFromWorkoutDto {
  @ApiPropertyOptional({ description: 'Tên mẫu; bỏ trống thì lấy tên buổi tập' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;
}

export class CreateCustomExerciseDto {
  @ApiProperty({ example: 'Đẩy tạ ống nước' }) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty({ example: 'Vai' }) @IsString() @IsNotEmpty() @MaxLength(60) primaryMuscle: string;
  @ApiPropertyOptional({ example: 'DUMBBELL' }) @IsOptional() @IsString() @MaxLength(30) equipment?: string;
  @ApiPropertyOptional({ enum: ['STRENGTH', 'CARDIO', 'OTHER'] }) @IsOptional() @IsIn(['STRENGTH', 'CARDIO', 'OTHER']) kind?: string;
}
