import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType, ServingUnit } from '@prisma/client';

export class CreateMealItemDto {
  @ApiProperty({ example: 'Phở bò tái', description: 'Tên món ăn' })
  @IsString({ message: 'Tên món ăn phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  name: string;

  @ApiPropertyOptional({ example: '1 tô vừa (~350g)', description: 'Khẩu phần / Đơn vị tính (mô tả tự do, hiển thị)' })
  @IsOptional()
  @IsString()
  servingSize?: string;

  @ApiPropertyOptional({ example: 350, description: 'Số lượng khẩu phần chuẩn hóa (đi kèm servingUnit)' })
  @IsOptional()
  @IsNumber({}, { message: 'Số lượng khẩu phần phải là số' })
  @Min(0, { message: 'Số lượng khẩu phần tối thiểu 0' })
  servingAmount?: number;

  @ApiPropertyOptional({ enum: ServingUnit, example: ServingUnit.GRAM, description: 'Đơn vị khẩu phần chuẩn hóa (GRAM, ML, PORTION)' })
  @IsOptional()
  @IsEnum(ServingUnit, { message: 'Đơn vị khẩu phần không hợp lệ (GRAM, ML, PORTION)' })
  servingUnit?: ServingUnit;

  @ApiPropertyOptional({ example: 1, description: 'Số lượng' })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  quantity?: number;

  @ApiProperty({ example: 450, description: 'Lượng calo (kcal)' })
  @IsNumber({}, { message: 'Calories phải là số' })
  @Min(0)
  calories: number;

  @ApiPropertyOptional({ example: 25, description: 'Lượng Protein (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  protein?: number;

  @ApiPropertyOptional({ example: 55, description: 'Lượng Carb (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  carb?: number;

  @ApiPropertyOptional({ example: 12, description: 'Lượng Fat (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fat?: number;

  @ApiPropertyOptional({ example: 'manual', description: 'Nguồn (manual, ai_vision, diet_plan)' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateMealDto {
  @ApiProperty({ enum: MealType, example: MealType.LUNCH, description: 'Loại bữa ăn' })
  @IsEnum(MealType, { message: 'Loại bữa ăn không hợp lệ (BREAKFAST, LUNCH, DINNER, SNACK)' })
  mealType: MealType;

  @ApiProperty({ example: '2026-08-19', description: 'Ngày ghi nhận bữa ăn (YYYY-MM-DD)' })
  @IsDateString({}, { message: 'Ngày phải có định dạng YYYY-MM-DD' })
  date: string;

  @ApiPropertyOptional({ example: 'https://example.com/meal.jpg', description: 'Link ảnh món ăn' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ type: [CreateMealItemDto], description: 'Danh sách các món ăn trong bữa' })
  @IsArray({ message: 'Danh sách món ăn phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateMealItemDto)
  items: CreateMealItemDto[];
}
