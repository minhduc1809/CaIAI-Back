import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ServingUnit } from '@prisma/client';

export class RecipeIngredientDto {
  @ApiProperty({
    example: 'Ức gà áp chảo',
    description: 'Tên nguyên liệu/thành phần',
  })
  @IsString({ message: 'Tên nguyên liệu phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên nguyên liệu không được để trống' })
  name: string;

  @ApiPropertyOptional({
    example: '150g',
    description: 'Khẩu phần ước tính của nguyên liệu này',
  })
  @IsOptional()
  @IsString()
  servingSize?: string;

  @ApiProperty({
    example: 250,
    description: 'Calo của riêng nguyên liệu này (kcal)',
  })
  @IsNumber({}, { message: 'Calories nguyên liệu phải là số' })
  @Min(0)
  @Max(5000, { message: 'Calo của nguyên liệu tối đa 5000 kcal' })
  calories: number;

  @ApiPropertyOptional({ example: 30, description: 'Protein (g)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Protein của nguyên liệu tối đa 500 g' })
  protein?: number;

  @ApiPropertyOptional({ example: 5, description: 'Carb (g)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Carb của nguyên liệu tối đa 500 g' })
  carb?: number;

  @ApiPropertyOptional({ example: 12, description: 'Fat (g)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Fat của nguyên liệu tối đa 500 g' })
  fat?: number;
}

export class CreateCustomFoodDto {
  @ApiProperty({
    example: 'Cơm gạo lứt thịt kho trứng',
    description: 'Tên món ăn tự tạo',
  })
  @IsString({ message: 'Tên món ăn phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  name: string;

  @ApiPropertyOptional({
    example: '1 phần (300g)',
    description: 'Khẩu phần / Đơn vị tính (mô tả tự do, hiển thị)',
  })
  @IsOptional()
  @IsString()
  servingSize?: string;

  @ApiPropertyOptional({
    example: 300,
    description: 'Số lượng khẩu phần chuẩn hóa (đi kèm servingUnit)',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Số lượng khẩu phần phải là số' })
  @Min(0, { message: 'Số lượng khẩu phần tối thiểu 0' })
  servingAmount?: number;

  @ApiPropertyOptional({
    enum: ServingUnit,
    example: ServingUnit.GRAM,
    description: 'Đơn vị khẩu phần chuẩn hóa (GRAM, ML, PORTION)',
  })
  @IsOptional()
  @IsEnum(ServingUnit, {
    message: 'Đơn vị khẩu phần không hợp lệ (GRAM, ML, PORTION)',
  })
  servingUnit?: ServingUnit;

  @ApiPropertyOptional({
    example: 480,
    description:
      'Lượng Calo (kcal) — bắt buộc nếu không truyền `ingredients`; nếu có `ingredients` thì trường này bị bỏ qua và tính lại bằng tổng',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Calories phải là số' })
  @Min(0)
  @Max(5000, { message: 'Calo món tự tạo tối đa 5000 kcal' })
  calories?: number;

  @ApiPropertyOptional({ example: 32, description: 'Lượng Protein (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Protein tối đa 500 g' })
  protein?: number;

  @ApiPropertyOptional({ example: 50, description: 'Lượng Carb (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Carb tối đa 500 g' })
  carb?: number;

  @ApiPropertyOptional({ example: 14, description: 'Lượng Fat (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500, { message: 'Fat tối đa 500 g' })
  fat?: number;

  @ApiPropertyOptional({
    type: [RecipeIngredientDto],
    description:
      'Công thức nhiều nguyên liệu (Recipe) — khi có, calo/macro tổng của món tự động tính bằng tổng các nguyên liệu, không cần nhập `calories` thủ công',
  })
  @IsOptional()
  @IsArray({ message: 'ingredients phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientDto)
  ingredients?: RecipeIngredientDto[];
}

export class UpdateCustomFoodDto extends PartialType(CreateCustomFoodDto) {}
