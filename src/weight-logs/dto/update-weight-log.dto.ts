import {
  IsOptional,
  IsNumber,
  IsString,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWeightLogDto {
  @ApiPropertyOptional({ example: 68.5, description: 'Cân nặng (kg)' })
  @IsOptional()
  @IsNumber({}, { message: 'Cân nặng phải là số' })
  @Min(20, { message: 'Cân nặng tối thiểu 20 kg' })
  @Max(300, { message: 'Cân nặng tối đa 300 kg' })
  weightKg?: number;

  @ApiPropertyOptional({
    example: 'Sau khi chạy bộ sáng',
    description: 'Ghi chú thời điểm cân',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: '2026-08-19',
    description: 'Ngày ghi nhận cân nặng',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
