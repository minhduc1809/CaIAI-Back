import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum ChatTokenPackageId {
  TOKEN_200K = 'TOKEN_200K',
  TOKEN_500K = 'TOKEN_500K',
  TOKEN_1M = 'TOKEN_1M',
  CUSTOM = 'CUSTOM',
}

export class PurchaseChatQuotaDto {
  @ApiProperty({
    enum: ChatTokenPackageId,
    description: 'Gói nạp token AI Coach: TOKEN_200K (+200k tokens), TOKEN_500K (+500k tokens), TOKEN_1M (+1 triệu tokens), CUSTOM',
    example: ChatTokenPackageId.TOKEN_200K,
  })
  @IsEnum(ChatTokenPackageId)
  packageId: ChatTokenPackageId;

  @ApiPropertyOptional({
    description: 'Số token tuỳ chọn nếu packageId = CUSTOM (ví dụ: 300000)',
    example: 300000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  customCredits?: number;
}
