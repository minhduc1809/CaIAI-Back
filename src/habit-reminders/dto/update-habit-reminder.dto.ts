import { PartialType } from '@nestjs/swagger';
import { CreateHabitReminderDto } from './create-habit-reminder.dto';
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateHabitReminderDto extends PartialType(
  CreateHabitReminderDto,
) {
  @ApiProperty({ required: false, example: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  waterIntervalMinutes?: number;
}
