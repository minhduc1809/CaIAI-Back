import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServingUnit } from '@prisma/client';

export class CreateCustomFoodDto {
  @ApiProperty({ example: 'Cơm gạo lứt thịt kho trứng', description: 'Tên món ăn tự tạo' })
  @IsString({ message: 'Tên món ăn phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  name: string;

  @ApiPropertyOptional({ example: '1 phần (300g)', description: 'Khẩu phần / Đơn vị tính (mô tả tự do, hiển thị)' })
  @IsOptional()
  @IsString()
  servingSize?: string;

  @ApiPropertyOptional({ example: 300, description: 'Số lượng khẩu phần chuẩn hóa (đi kèm servingUnit)' })
  @IsOptional()
  @IsNumber({}, { message: 'Số lượng khẩu phần phải là số' })
  @Min(0, { message: 'Số lượng khẩu phần tối thiểu 0' })
  servingAmount?: number;

  @ApiPropertyOptional({ enum: ServingUnit, example: ServingUnit.GRAM, description: 'Đơn vị khẩu phần chuẩn hóa (GRAM, ML, PORTION)' })
  @IsOptional()
  @IsEnum(ServingUnit, { message: 'Đơn vị khẩu phần không hợp lệ (GRAM, ML, PORTION)' })
  servingUnit?: ServingUnit;

  @ApiProperty({ example: 480, description: 'Lượng Calo (kcal)' })
  @IsNumber({}, { message: 'Calories phải là số' })
  @Min(0)
  calories: number;

  @ApiPropertyOptional({ example: 32, description: 'Lượng Protein (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  protein?: number;

  @ApiPropertyOptional({ example: 50, description: 'Lượng Carb (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  carb?: number;

  @ApiPropertyOptional({ example: 14, description: 'Lượng Fat (gram)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fat?: number;
}
