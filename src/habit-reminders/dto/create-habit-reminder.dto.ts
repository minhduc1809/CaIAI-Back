import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateHabitReminderDto {
  @ApiProperty({ example: 'Bữa xế chiều' })
  @IsString()
  @IsNotEmpty({ message: 'Tên nhắc nhở không được để trống' })
  label: string;

  @ApiProperty({ example: '15:30' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'Giờ báo phải theo định dạng HH:mm' })
  timeOfDay: string;

  @ApiProperty({ required: false, example: '15:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, {
    message: 'Khung giờ bắt đầu phải theo định dạng HH:mm',
  })
  windowStart?: string;

  @ApiProperty({ required: false, example: '16:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, {
    message: 'Khung giờ kết thúc phải theo định dạng HH:mm',
  })
  windowEnd?: string;

  @ApiProperty({ required: false, example: 300 })
  @IsOptional()
  targetCalorieMin?: number;

  @ApiProperty({ required: false, example: 450 })
  @IsOptional()
  targetCalorieMax?: number;

  @ApiProperty({
    required: false,
    type: [Number],
    example: [1, 2, 3, 4, 5, 6, 7],
  })
  @IsOptional()
  @IsArray()
  repeatDays?: number[];

  @ApiProperty({ required: false, example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  advanceNoticeMinutes?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
