import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecognizeFoodBase64Dto {
  @ApiProperty({
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    description:
      'Chuỗi base64 của hình ảnh món ăn (kèm hoặc không kèm data prefix)',
  })
  @IsString()
  @IsNotEmpty({ message: 'base64Image không được để trống' })
  base64Image: string;

  @ApiPropertyOptional({
    example: 'image/jpeg',
    description: 'MIME type của ảnh (mặc định là image/jpeg)',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;
}
