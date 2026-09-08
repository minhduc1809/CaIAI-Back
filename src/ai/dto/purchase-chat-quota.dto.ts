import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum ChatPlanPackageId {
  PLUS = 'PLUS',
  PRO = 'PRO',
  MAX = 'MAX',
  CUSTOM = 'CUSTOM',
}

export class PurchaseChatQuotaDto {
  @ApiProperty({
    enum: ChatPlanPackageId,
    description:
      'Bản nâng cấp AI Coach: PLUS (Bản Plus), PRO (Bản Pro - Phổ biến nhất), MAX (Bản Max - Cao cấp nhất), CUSTOM',
    example: ChatPlanPackageId.PRO,
  })
  @IsEnum(ChatPlanPackageId)
  packageId: ChatPlanPackageId;

  @ApiPropertyOptional({
    description: 'Hạn mức bổ sung tuỳ chọn nếu packageId = CUSTOM',
    example: 300000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  customCredits?: number;
}
