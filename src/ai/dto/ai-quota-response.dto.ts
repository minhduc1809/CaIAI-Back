import { ApiProperty } from '@nestjs/swagger';

export class AiQuotaResponseDto {
  @ApiProperty({ example: 'food_recognition', description: 'Tính năng AI đang kiểm tra' })
  feature: string;

  @ApiProperty({ example: 5, description: 'Giới hạn số lượt chụp ảnh tối đa mỗi ngày' })
  dailyLimit: number;

  @ApiProperty({ example: 2, description: 'Số lượt đã sử dụng hôm nay' })
  usedToday: number;

  @ApiProperty({ example: 3, description: 'Số lượt còn lại trong ngày' })
  remainingQuota: number;

  @ApiProperty({ example: '2026-09-09T00:00:00.000+07:00', description: 'Thời điểm bắt đầu ngày mới (reset quota)' })
  resetsAt: string;
}
