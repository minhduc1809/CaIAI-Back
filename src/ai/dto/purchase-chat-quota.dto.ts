import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum ChatPackageId {
  CHAT_20 = 'CHAT_20',
  CHAT_50 = 'CHAT_50',
  CHAT_100 = 'CHAT_100',
  CUSTOM = 'CUSTOM',
}

export class PurchaseChatQuotaDto {
  @ApiProperty({
    enum: ChatPackageId,
    description: 'Gói tin nhắn: CHAT_20 (+20), CHAT_50 (+50), CHAT_100 (+100), CUSTOM',
    example: ChatPackageId.CHAT_20,
  })
  @IsEnum(ChatPackageId)
  packageId: ChatPackageId;

  @ApiPropertyOptional({
    description: 'Số tin nhắn tuỳ chọn nếu packageId = CUSTOM',
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customCredits?: number;
}
