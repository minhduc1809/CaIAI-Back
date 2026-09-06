import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID Token do Google Sign-In (Android Credential Manager) trả về sau khi người dùng xác thực',
  })
  @IsString({ message: 'idToken phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'idToken không được để trống' })
  idToken: string;
}
