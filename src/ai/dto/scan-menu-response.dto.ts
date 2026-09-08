import { ApiProperty } from '@nestjs/swagger';

export class MenuItemDto {
  @ApiProperty({ example: 'Phở bò tái nạc' })
  name: string;

  @ApiProperty({ example: '55.000đ', required: false, nullable: true })
  price: string | null;

  @ApiProperty({ example: 480 })
  estimatedCalories: number;

  @ApiProperty({ example: 34 })
  protein: number;

  @ApiProperty({ example: 60 })
  carbs: number;

  @ApiProperty({ example: 10 })
  fat: number;

  @ApiProperty({ example: 'Bò tái tươi ngon, nước dùng thanh' })
  description: string;

  @ApiProperty({ example: true })
  isRecommended: boolean;

  @ApiProperty({
    example: 'Cung cấp protein chất lượng cao, phù hợp ngân sách calo còn lại hôm nay',
    required: false,
    nullable: true,
  })
  recommendationReason: string | null;
}

export class ScanMenuResponseDto {
  @ApiProperty({ example: 'Quán Phở Bò Gia Truyền', required: false, nullable: true })
  restaurantName: string | null;

  @ApiProperty({ type: [MenuItemDto] })
  items: MenuItemDto[];

  @ApiProperty({ type: [MenuItemDto] })
  recommendedItems: MenuItemDto[];

  @ApiProperty({ example: 'Menu có nhiều lựa chọn giàu protein, ưu tiên món nước để dễ kiểm soát khẩu phần.' })
  summaryAdvice: string;
}
