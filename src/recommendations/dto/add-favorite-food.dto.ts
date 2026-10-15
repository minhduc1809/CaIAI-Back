import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFavoriteFoodDto {
  @ApiProperty({
    example: 'Phở bò tái nạc',
    description: 'Tên món ăn muốn thêm vào yêu thích',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  foodName: string;

  @ApiPropertyOptional({ enum: ['CATALOG', 'CUSTOM'], description: 'Nguồn món (BR-08.3); bỏ trống thì máy chủ tự tra theo tên' })
  @IsOptional()
  @IsIn(['CATALOG', 'CUSTOM'])
  sourceType?: 'CATALOG' | 'CUSTOM';

  @ApiPropertyOptional({ description: 'Mã món trong kho hoặc món tự tạo' })
  @IsOptional()
  @IsString()
  sourceId?: string;
}
