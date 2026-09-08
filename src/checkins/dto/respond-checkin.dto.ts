import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Mood } from '@prisma/client';

export type CheckInAction = 'ACCEPT' | 'DECLINE' | 'DISMISS';

export class RespondCheckinDto {
  @ApiProperty({ enum: ['ACCEPT', 'DECLINE', 'DISMISS'], description: 'Hành động của người dùng với đề xuất check-in' })
  @IsEnum(['ACCEPT', 'DECLINE', 'DISMISS'])
  action: CheckInAction;

  @ApiPropertyOptional({ enum: Mood })
  @IsOptional()
  @IsEnum(Mood)
  mood?: Mood;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
