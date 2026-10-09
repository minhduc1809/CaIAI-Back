import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminGrantPremiumDto {
  @ApiProperty({
    example: 'usr_cuid_12345',
    description: 'ID người dùng được cấp',
  })
  @IsString({ message: 'User ID phải là chuỗi' })
  @IsNotEmpty({ message: 'User ID không được để trống' })
  userId: string;

  @ApiProperty({
    example: 30,
    description: 'Số ngày Premium cấp thêm (1-90 ngày)',
  })
  @IsInt({ message: 'Số ngày phải là số nguyên' })
  @Min(1, { message: 'Số ngày tối thiểu là 1' })
  @Max(90, {
    message: 'Cấp thủ công tối đa 90 ngày mỗi lần (admin.maxGrantDays)',
  })
  days: number;

  @ApiProperty({
    example: 'Bù sự cố bảo trì hệ thống ngày 09/10/2026',
    description: 'Lý do cấp quyền (bắt buộc >= 10 ký tự để kiểm toán)',
  })
  @IsString({ message: 'Lý do phải là chuỗi' })
  @IsNotEmpty({ message: 'Lý do không được để trống' })
  @MinLength(10, { message: 'Lý do cấp quyền phải có ít nhất 10 ký tự' })
  reason: string;
}

export class AdminRevokeGrantDto {
  @ApiProperty({
    example: 'Người dùng vi phạm điều khoản chính sách thanh toán',
    description: 'Lý do thu hồi quyền (bắt buộc >= 10 ký tự)',
  })
  @IsString({ message: 'Lý do phải là chuỗi' })
  @IsNotEmpty({ message: 'Lý do không được để trống' })
  @MinLength(10, { message: 'Lý do thu hồi phải có ít nhất 10 ký tự' })
  reason: string;
}
