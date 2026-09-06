import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: '123456', description: 'Mã OTP 6 chữ số gửi tới email người dùng' })
  @IsString({ message: 'Mã xác thực phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mã xác thực không được để trống' })
  @Length(6, 6, { message: 'Mã xác thực phải gồm đúng 6 chữ số' })
  code: string;
}
