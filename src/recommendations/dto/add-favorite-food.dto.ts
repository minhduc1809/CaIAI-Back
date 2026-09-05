import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddFavoriteFoodDto {
  @ApiProperty({ example: 'Phở bò tái nạc', description: 'Tên món ăn muốn thêm vào yêu thích' })
  @IsString()
  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  foodName: string;
}
