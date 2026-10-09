import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentOrderStatus } from '@prisma/client';

export class QueryOrdersDto {
  @ApiPropertyOptional({ example: 1, description: 'Trang' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Số lượng' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: PaymentOrderStatus,
    description: 'Trạng thái đơn (PENDING, PAID, EXPIRED, CANCELED)',
  })
  @IsOptional()
  @IsEnum(PaymentOrderStatus)
  status?: PaymentOrderStatus;

  @ApiPropertyOptional({
    example: 'NWK7M2QX9A',
    description: 'Tìm theo mã chuyển khoản hoặc email',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class RejectOrderDto {
  @ApiPropertyOptional({
    example: 'Khách hàng yêu cầu huỷ đơn do chuyển khoản nhầm',
    description: 'Lý do từ chối/huỷ đơn',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
