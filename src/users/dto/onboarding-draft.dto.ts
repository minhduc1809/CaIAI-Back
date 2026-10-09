import { IsInt, Min, Max, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SaveOnboardingDraftDto {
  @ApiProperty({
    example: 3,
    description: 'Chỉ số bước Onboarding đang hoàn thành dở (0–12)',
  })
  @IsInt({ message: 'Bước onboarding phải là số nguyên' })
  @Min(0, { message: 'Bước tối thiểu là 0' })
  @Max(15, { message: 'Bước tối đa là 15' })
  step: number;

  @ApiProperty({
    example: {
      gender: 'MALE',
      heightCm: 175,
      weightKg: 70,
    },
    description: 'Dữ liệu các trường đã điền trong Onboarding',
  })
  @IsObject({ message: 'Dữ liệu nháp phải là một đối tượng JSON' })
  data: Record<string, any>;
}
