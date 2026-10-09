import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { IsNotFutureDate } from '../../common/validators/not-future-date.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWeightLogDto {
  @ApiProperty({ example: 68.5, description: 'Cân nặng ghi nhận (kg)' })
  @IsNumber({}, { message: 'Cân nặng phải là số' })
  @Min(25, { message: 'Cân nặng tối thiểu 25 kg' })
  @Max(300, { message: 'Cân nặng tối đa 300 kg' })
  @IsNotEmpty({ message: 'Cân nặng không được để trống' })
  weightKg: number;

  @ApiPropertyOptional({
    example: 'Cân vào buổi sáng sau khi ngủ dậy',
    description: 'Ghi chú thêm',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: '2026-09-04T07:00:00.000Z',
    description: 'Thời điểm ghi nhận cân nặng (mặc định là hiện tại)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày không đúng định dạng ISO' })
  @IsNotFutureDate()
  date?: string;
}
