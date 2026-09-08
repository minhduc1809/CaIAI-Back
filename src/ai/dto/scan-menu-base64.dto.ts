import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanMenuBase64Dto {
  @ApiProperty({ description: 'Chuỗi base64 của ảnh chụp thực đơn' })
  @IsString()
  @IsNotEmpty()
  imageBase64: string;

  @ApiProperty({ required: false, description: 'Ghi chú thêm của người dùng (ví dụ: đang ăn kiêng, dị ứng...)' })
  @IsString()
  @IsOptional()
  note?: string;
}
