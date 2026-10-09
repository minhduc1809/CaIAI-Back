import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';

export class QuickAddMealDto {
  @ApiProperty({
    example: 'Phở bò ăn ngoài',
    description: 'Tên hoặc mô tả bữa ăn nhanh',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên bữa ăn không được để trống' })
  @MaxLength(200, { message: 'Tên bữa ăn tối đa 200 ký tự' })
  name: string;

  @ApiProperty({
    enum: MealType,
    example: MealType.LUNCH,
    description: 'Loại bữa ăn',
  })
  @IsEnum(MealType, {
    message: 'Loại bữa ăn không hợp lệ (BREAKFAST, LUNCH, DINNER, SNACK)',
  })
  mealType: MealType;

  @ApiProperty({
    example: '2026-08-19',
    description: 'Ngày ghi nhận bữa ăn (YYYY-MM-DD)',
  })
  @IsDateString({}, { message: 'Ngày phải có định dạng YYYY-MM-DD' })
  date: string;

  @ApiProperty({ example: 500, description: 'Lượng calo ước lượng (kcal)' })
  @IsNumber({}, { message: 'Calories phải là số' })
  @Min(0)
  @Max(10000, { message: 'Calo của một bữa tối đa 10000 kcal' })
  calories: number;

  @ApiPropertyOptional({
    example: 25,
    description: 'Lượng Protein ước lượng (gram)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000, { message: 'Lượng protein của một bữa tối đa 1000 g' })
  protein?: number;

  @ApiPropertyOptional({
    example: 60,
    description: 'Lượng Carb ước lượng (gram)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000, { message: 'Lượng carb của một bữa tối đa 1000 g' })
  carb?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Lượng Fat ước lượng (gram)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000, { message: 'Lượng fat của một bữa tối đa 1000 g' })
  fat?: number;
}
