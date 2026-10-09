import { ApiProperty } from '@nestjs/swagger';

export class InsightDto {
  @ApiProperty({ enum: ['PLATEAU', 'GOAL_DEVIATION'] })
  type: 'PLATEAU' | 'GOAL_DEVIATION';

  @ApiProperty({ description: 'Tiêu đề ngắn, ai cũng thấy' })
  title: string;

  @ApiProperty({
    description: 'Nội dung chi tiết. Rỗng khi `locked` = true (người dùng Free)',
  })
  message: string;

  @ApiProperty({ description: 'true: nội dung chi tiết chỉ dành cho Premium' })
  locked: boolean;
}
