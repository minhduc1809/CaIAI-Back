import { IsOptional, IsString, IsInt, Min, Max, IsEnum, IsIn, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class QueryUsersDto {
  @ApiPropertyOptional({ example: 1, description: 'Trang hiện tại' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Số lượng mỗi trang' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'test@example.com', description: 'Tìm theo email, tên đăng nhập hoặc họ tên' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: Role, description: 'Lọc theo vai trò (USER, ADMIN)' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ description: 'Tương thích cũ: true/false lọc Premium. Dùng `plan` cho bộ lọc đầy đủ.' })
  @IsOptional()
  @IsString()
  isPremium?: string;

  @ApiPropertyOptional({ enum: ['FREE', 'PREMIUM', 'TRIAL', 'GRACE'], description: 'Lọc theo gói' })
  @IsOptional()
  @IsIn(['FREE', 'PREMIUM', 'TRIAL', 'GRACE'])
  plan?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'LOCKED'], description: 'Trạng thái tài khoản' })
  @IsOptional()
  @IsIn(['ACTIVE', 'LOCKED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Đã xác thực email chưa' })
  @IsOptional()
  @IsIn(['true', 'false'])
  emailVerified?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Đăng ký từ ngày (giờ Việt Nam)' })
  @IsOptional()
  @Matches(DAY, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Đăng ký đến hết ngày (giờ Việt Nam)' })
  @IsOptional()
  @Matches(DAY, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'email', 'name'] })
  @IsOptional()
  @IsIn(['createdAt', 'email', 'name'])
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: string;
}
