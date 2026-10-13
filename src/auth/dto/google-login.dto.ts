import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'ID Token do Google Sign-In (Android Credential Manager) trả về sau khi người dùng xác thực',
  })
  @IsString({ message: 'idToken phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'idToken không được để trống' })
  idToken: string;

  @ApiPropertyOptional({ description: 'Đã đồng ý Chính sách quyền riêng tư; bắt buộc khi Google tạo tài khoản MỚI' })
  @IsOptional()
  @IsBoolean()
  acceptPrivacy?: boolean;
}
