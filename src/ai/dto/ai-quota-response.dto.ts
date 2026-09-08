import { ApiProperty } from '@nestjs/swagger';

export class AiQuotaResponseDto {
  @ApiProperty({
    example: 'food_recognition',
    description: 'Tính năng AI đang kiểm tra',
  })
  feature: string;

  @ApiProperty({
    example: 5,
    description: 'Giới hạn số lượt miễn phí mỗi ngày',
  })
  dailyFreeLimit: number;

  @ApiProperty({ example: 2, description: 'Số lượt miễn phí đã dùng hôm nay' })
  freeUsedToday: number;

  @ApiProperty({
    example: 3,
    description: 'Số lượt miễn phí còn lại hôm nay (tối đa 5 lượt/ngày)',
  })
  freeRemaining: number;

  @ApiProperty({
    example: 20,
    description: 'Số lượt chụp mua thêm đang có (không bao giờ hết hạn)',
  })
  purchasedCredits: number;

  @ApiProperty({
    example: 23,
    description:
      'Tổng số lượt chụp có thể sử dụng ngay (Lượt miễn phí hôm nay + Lượt đã mua)',
  })
  totalRemaining: number;

  @ApiProperty({
    example: '2026-09-09T00:00:00.000+07:00',
    description: 'Thời điểm reset 5 lượt miễn phí sang ngày mới',
  })
  resetsAt: string;
}
