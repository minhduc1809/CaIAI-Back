import { IsOptional, IsInt, Min, Max, IsEnum, IsString, IsIn, Matches } from 'class-validator';
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

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Tạo từ ngày (giờ Việt Nam)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Tạo đến hết ngày (giờ Việt Nam)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ description: 'Số tiền tối thiểu (VND)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Số tiền tối đa (VND)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAmount?: number;

  @ApiPropertyOptional({ enum: ['createdAt', 'amount', 'expiresAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'amount', 'expiresAt'])
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: string;
}

export class RejectOrderDto {
  @ApiPropertyOptional({
    example: 'Khách hàng yêu cầu huỷ đơn do chuyển khoản nhầm',
    description: 'Lý do từ chối/huỷ đơn',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Mật khẩu admin để xác thực lại' })
  @IsOptional()
  @IsString()
  password?: string;
}
