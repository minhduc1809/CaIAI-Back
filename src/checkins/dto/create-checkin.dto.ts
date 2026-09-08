import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Mood } from '@prisma/client';

export class CreateCheckinDto {
  @ApiPropertyOptional({ enum: Mood, description: 'Tâm trạng người dùng tuần qua' })
  @IsOptional()
  @IsEnum(Mood)
  mood?: Mood;

  @ApiPropertyOptional({ description: 'Ghi chú tự do của người dùng' })
  @IsOptional()
  @IsString()
  note?: string;
}
