import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AttachHabitReminderFoodDto {
  @ApiProperty({ example: 'Salad gà & chà là' })
  @IsString()
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  name: string;

  @ApiProperty({ required: false, example: '1 đĩa tiêu chuẩn • 250g' })
  @IsOptional()
  @IsString()
  servingSize?: string;

  @ApiProperty({ example: 220 })
  @IsNumber()
  @Min(0)
  calories: number;

  @ApiProperty({ example: 22 })
  @IsNumber()
  @Min(0)
  protein: number;

  @ApiProperty({ example: 18 })
  @IsNumber()
  @Min(0)
  carb: number;

  @ApiProperty({ example: 6 })
  @IsNumber()
  @Min(0)
  fat: number;
}
