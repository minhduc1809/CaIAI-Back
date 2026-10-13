import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({
    example: 'admin@nutriwise.vn',
    description: 'Email tài khoản quản trị',
  })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @ApiProperty({
    example: 'AdminPassword@123',
    description: 'Mật khẩu quản trị',
  })
  @IsString({ message: 'Mật khẩu phải là chuỗi' })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password: string;

  @ApiPropertyOptional({ example: '123456', description: 'Mã xác thực hai lớp (TOTP 6 số hoặc mã dự phòng), bắt buộc nếu tài khoản đã bật' })
  @IsOptional()
  @IsString()
  totpCode?: string;
}
