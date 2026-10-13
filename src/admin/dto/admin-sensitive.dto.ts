import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Thân yêu cầu cho thao tác nhạy cảm: lý do và mật khẩu xác thực lại. Backend kiểm tra cả hai. */
export class SensitiveActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
