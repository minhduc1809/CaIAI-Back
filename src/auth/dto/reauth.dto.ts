import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReauthPasswordDto {
  @ApiProperty({
    description: 'Mật khẩu hiện tại để xác thực lại trước thao tác nhạy cảm',
  })
  @IsString({ message: 'Mật khẩu phải là chuỗi' })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}

export class ReauthGoogleDto {
  @ApiProperty({ description: 'Google idToken để xác thực lại' })
  @IsString({ message: 'idToken phải là chuỗi' })
  @IsNotEmpty({ message: 'idToken không được để trống' })
  idToken: string;
}

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description: 'Token xác thực lại cấp từ POST auth/reauth',
  })
  @IsString({ message: 'reauthToken phải là chuỗi' })
  @IsOptional()
  reauthToken?: string;
}
