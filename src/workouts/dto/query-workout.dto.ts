import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkoutCategory } from '@prisma/client';

export class QueryWorkoutDto {
  @ApiPropertyOptional({
    example: '2026-09-05',
    description: 'Lọc buổi tập theo ngày cụ thể (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Ngày bắt đầu khoảng tra cứu (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-09-07',
    description: 'Ngày kết thúc khoảng tra cứu (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({
    enum: WorkoutCategory,
    description: 'Lọc theo phân loại bài tập',
  })
  @IsOptional()
  @IsEnum(WorkoutCategory)
  category?: WorkoutCategory;
}
