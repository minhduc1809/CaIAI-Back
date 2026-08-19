import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWeightLogDto {
  @ApiProperty({ example: 68.5, description: 'Cân nặng ghi nhận (kg)' })
  @IsNumber({}, { message: 'Cân nặng phải là số' })
  @Min(20, { message: 'Cân nặng tối thiểu 20 kg' })
  @Max(300, { message: 'Cân nặng tối đa 300 kg' })
  @IsNotEmpty({ message: 'Cân nặng không được để trống' })
  weightKg: number;

  @ApiPropertyOptional({ example: 'Cân vào buổi sáng sau khi ngủ dậy', description: 'Ghi chú thêm' })
  @IsOptional()
  @IsString()
  note?: string;
}
