import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const GENDER_TARGETS = ['MALE', 'FEMALE', 'ALL'] as const;
export const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const EQUIPMENT = ['NO_EQUIPMENT', 'DUMBBELL', 'GYM_MACHINE', 'RESISTANCE_BAND'] as const;

export class ExerciseInstructionsDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) preparation: string;
  @IsString() @IsNotEmpty() @MaxLength(1500) execution: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) commonMistakes: string;
  @IsString() @IsNotEmpty() @MaxLength(600) breathing: string;
}

export class AdminCreateExerciseDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @ApiProperty({ enum: GENDER_TARGETS }) @IsIn([...GENDER_TARGETS]) genderTarget: string;
  @ApiProperty({ enum: LEVELS }) @IsIn([...LEVELS]) level: string;
  @ApiProperty({ example: 'Ngực, Vai trước' }) @IsString() @IsNotEmpty() @MaxLength(120) targetMuscle: string;
  @ApiProperty({ enum: EQUIPMENT }) @IsIn([...EQUIPMENT]) equipment: string;
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) @Max(20) sets: number;
  @ApiProperty({ example: '10-12 lần' }) @IsString() @IsNotEmpty() @MaxLength(60) repsOrDuration: string;
  @ApiProperty({ example: 60 }) @IsInt() @Min(0) @Max(600) restSeconds: number;
  @ApiProperty({ example: 30, description: 'Ước tính calo đốt mỗi hiệp' }) @IsNumber() @Min(0) @Max(500) caloriesBurnedEstimate: number;
  @ApiPropertyOptional() @IsOptional() @IsUrl() imageUrl?: string;
  @ApiPropertyOptional({ description: 'Link video hướng dẫn (https)' }) @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(300) videoUrl?: string;
  @ApiProperty({ type: ExerciseInstructionsDto }) @ValidateNested() @Type(() => ExerciseInstructionsDto) instructions: ExerciseInstructionsDto;
}

class PartialInstructionsDto {
  @IsOptional() @IsString() @MaxLength(1000) preparation?: string;
  @IsOptional() @IsString() @MaxLength(1500) execution?: string;
  @IsOptional() @IsString() @MaxLength(1000) commonMistakes?: string;
  @IsOptional() @IsString() @MaxLength(600) breathing?: string;
}

export class AdminUpdateExerciseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsIn([...GENDER_TARGETS]) genderTarget?: string;
  @IsOptional() @IsIn([...LEVELS]) level?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) targetMuscle?: string;
  @IsOptional() @IsIn([...EQUIPMENT]) equipment?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) sets?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) repsOrDuration?: string;
  @IsOptional() @IsInt() @Min(0) @Max(600) restSeconds?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(500) caloriesBurnedEstimate?: number;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) videoUrl?: string;
  @IsOptional() @ValidateNested() @Type(() => PartialInstructionsDto) instructions?: PartialInstructionsDto;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
