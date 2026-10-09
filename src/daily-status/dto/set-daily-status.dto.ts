import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DayCompleteness } from '@prisma/client';

export class SetDailyStatusDto {
  @ApiProperty({
    enum: DayCompleteness,
    example: DayCompleteness.COMPLETE,
    description:
      'COMPLETE = "Đã ghi đủ hôm nay"; INCOMPLETE = "Hôm nay ghi chưa đủ" (loại ngày khỏi tính toán); AUTO = để hệ thống quyết định',
  })
  @IsEnum(DayCompleteness, { message: 'completeness không hợp lệ' })
  completeness: DayCompleteness;
}
