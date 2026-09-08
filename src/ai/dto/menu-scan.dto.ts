import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanMenuBase64Dto {
  @ApiProperty({
    description: 'Ảnh menu định dạng base64 (data:image/... hoặc raw base64)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ description: 'Ghi chú thêm về sở thích/dị ứng' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class MenuItemDto {
  @ApiProperty({ example: 'Bún chả Hà Nội' })
  name: string;

  @ApiPropertyOptional({ example: '55,000 VNĐ' })
  price?: string;

  @ApiProperty({ example: 580 })
  estimatedCalories: number;

  @ApiProperty({ example: 28 })
  protein: number;

  @ApiProperty({ example: 65 })
  carbs: number;

  @ApiProperty({ example: 20 })
  fat: number;

  @ApiProperty({ example: 'Chả nướng, bún tươi, nước mắm chấm dưa góp' })
  description: string;

  @ApiProperty({
    example: false,
    description: 'Có phải món AI gợi ý chọn nhất không',
  })
  isRecommended: boolean;

  @ApiPropertyOptional({
    example: 'Món này vừa vặn lượng calo và protein bạn đang thiếu hôm nay',
  })
  recommendationReason?: string;
}

export class ScanMenuResponseDto {
  @ApiProperty({
    example: 'Quán Cơm Tấm & Bún Chả',
    description: 'Tên quán ăn nếu đọc được từ menu',
  })
  restaurantName?: string;

  @ApiProperty({
    type: [MenuItemDto],
    description: 'Danh sách các món ăn nhận diện từ menu',
  })
  items: MenuItemDto[];

  @ApiProperty({
    type: [MenuItemDto],
    description: 'Top 1-2 món khuyến nghị chọn nhất cho mục tiêu hôm nay',
  })
  recommendedItems: MenuItemDto[];

  @ApiProperty({
    example:
      'Bạn còn 650 kcal và 35g protein. Món Bún chả là lựa chọn lý tưởng nhất!',
  })
  summaryAdvice: string;
}
