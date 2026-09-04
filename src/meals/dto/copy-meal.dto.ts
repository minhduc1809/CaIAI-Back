import { IsNotEmpty, IsDateString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';

export class CopyMealDto {
  @ApiProperty({ example: '2026-08-20', description: 'Ngày đích cần sao chép bữa ăn sang (YYYY-MM-DD)' })
  @IsDateString({}, { message: 'targetDate phải có định dạng YYYY-MM-DD' })
  @IsNotEmpty()
  targetDate: string;

  @ApiPropertyOptional({ enum: MealType, example: MealType.LUNCH, description: 'Loại bữa ăn mới (tùy chọn)' })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}
