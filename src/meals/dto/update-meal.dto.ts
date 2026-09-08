import {
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import { CreateMealItemDto } from './create-meal.dto';

export class UpdateMealDto {
  @ApiPropertyOptional({
    enum: MealType,
    example: MealType.DINNER,
    description: 'Loại bữa ăn',
  })
  @IsOptional()
  @IsEnum(MealType, {
    message: 'Loại bữa ăn không hợp lệ (BREAKFAST, LUNCH, DINNER, SNACK)',
  })
  mealType?: MealType;

  @ApiPropertyOptional({
    example: '2026-08-19',
    description: 'Ngày ghi nhận bữa ăn (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày phải có định dạng YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/new-meal.jpg',
    description: 'Link ảnh món ăn',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    type: [CreateMealItemDto],
    description: 'Danh sách các món ăn mới',
  })
  @IsOptional()
  @IsArray({ message: 'Danh sách món ăn phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateMealItemDto)
  items?: CreateMealItemDto[];
}
