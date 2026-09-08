import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';

export class PurchaseAiQuotaDto {
  @ApiProperty({
    example: 'PACKAGE_20',
    description: 'Mã gói lượt chụp: PACKAGE_10 (10 lượt), PACKAGE_20 (20 lượt), PACKAGE_50 (50 lượt), PACKAGE_100 (100 lượt)',
    required: false,
  })
  @IsOptional()
  @IsString()
  packageId?: string;

  @ApiProperty({
    example: 10,
    description: 'Số lượt mua tùy chỉnh (từ 1 đến 500 lượt)',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  customCredits?: number;
}

export class AiScanPackageDto {
  @ApiProperty({ example: 'PACKAGE_10' })
  id: string;

  @ApiProperty({ example: 'Gói Khởi Động' })
  name: string;

  @ApiProperty({ example: 10 })
  credits: number;

  @ApiProperty({ example: 29000 })
  priceVnd: number;

  @ApiProperty({ example: '10 lượt chụp ảnh AI nhận diện món ăn không giới hạn thời gian sử dụng' })
  description: string;

  @ApiProperty({ example: false, required: false })
  isPopular?: boolean;

  @ApiProperty({ example: false, required: false })
  bestValue?: boolean;
}
