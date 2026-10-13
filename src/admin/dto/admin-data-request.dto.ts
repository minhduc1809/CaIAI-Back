import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const REQUEST_TYPES = ['EXPORT', 'DELETE', 'COMPLAINT'] as const;
export const REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED'] as const;

/** Ghi nhận một yêu cầu quyền dữ liệu nhận qua email. */
export class CreateDataRequestDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email: string;

  @IsIn([...REQUEST_TYPES], { message: 'Loại yêu cầu phải là EXPORT, DELETE hoặc COMPLAINT' })
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateDataRequestDto {
  @IsIn([...REQUEST_STATUSES])
  status: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resultNote?: string;
}
