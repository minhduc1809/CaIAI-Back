import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Admin@123', description: 'Mật khẩu hiện tại' })
  @IsString({ message: 'Mật khẩu cũ phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mật khẩu cũ không được để trống' })
  oldPassword: string;

  @ApiProperty({
    example: 'NewAdmin@456',
    description:
      'Mật khẩu mới: Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số',
  })
  @IsString({ message: 'Mật khẩu mới phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự' })
  @MaxLength(50, { message: 'Mật khẩu mới tối đa 50 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Mật khẩu mới phải chứa ít nhất 1 chữ thường, 1 chữ HOA và 1 số',
  })
  newPassword: string;
}
