import { ApiProperty } from '@nestjs/swagger';
import { ReminderType } from '@prisma/client';

export class HabitReminderFoodResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ required: false, nullable: true }) servingSize: string | null;
  @ApiProperty() calories: number;
  @ApiProperty() protein: number;
  @ApiProperty() carb: number;
  @ApiProperty() fat: number;
}

export class HabitReminderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ReminderType }) type: ReminderType;
  @ApiProperty() label: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() timeOfDay: string;
  @ApiProperty({ required: false, nullable: true }) windowStart: string | null;
  @ApiProperty({ required: false, nullable: true }) windowEnd: string | null;
  @ApiProperty({ required: false, nullable: true }) targetCalorieMin:
    number | null;
  @ApiProperty({ required: false, nullable: true }) targetCalorieMax:
    number | null;
  @ApiProperty({ required: false, nullable: true }) waterIntervalMinutes:
    number | null;
  @ApiProperty({ type: [Number] }) repeatDays: number[];
  @ApiProperty() advanceNoticeMinutes: number;
  @ApiProperty() sortOrder: number;
  @ApiProperty({ type: [HabitReminderFoodResponseDto] })
  foods: HabitReminderFoodResponseDto[];
}
