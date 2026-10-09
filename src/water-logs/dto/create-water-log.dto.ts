import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWaterLogDto {
  @ApiPropertyOptional({
    example: 250,
    description: 'Lượng nước (ml), mặc định 250 (1 ly)',
  })
  @IsOptional()
  @IsInt({ message: 'Lượng nước phải là số nguyên (ml)' })
  @Min(50, { message: 'Lượng nước tối thiểu 50ml' })
  @Max(1500, { message: 'Lượng nước tối đa 1500ml mỗi lần' })
  amountMl?: number;
}
