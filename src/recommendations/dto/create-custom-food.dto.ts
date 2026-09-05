import { IsNotEmpty, IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomFoodDto {
  @ApiProperty({ example: 'Cơm gạo lứt thịt kho trứng', description: 'Tên món ăn tự tạo' })
  @IsString({ message: 'Tên món ăn phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  name: string;

  @ApiPropertyOptional({ example: '1 phần (300g)', description: 'Khẩu phần / Đơn vị tính' })
  @IsOptional()
  @IsString()
  servingSize?: string;

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
