import { ApiProperty } from '@nestjs/swagger';

export class WeeklySummaryResponseDto {
  @ApiProperty({ example: '2026-09-07' })
  weekStartDate: string;

  @ApiProperty({ example: '2026-09-13' })
  weekEndDate: string;

  @ApiProperty({ example: 1850, nullable: true })
  avgCalories: number | null;

  @ApiProperty({ example: 120, nullable: true })
  avgProtein: number | null;

  @ApiProperty({ example: 55, nullable: true })
  avgFat: number | null;

  @ApiProperty({ example: 210, nullable: true })
  avgCarb: number | null;

  @ApiProperty({ example: -0.4, nullable: true })
  weightChangeKg: number | null;

  @ApiProperty({ example: 3 })
  workoutsCompleted: number;

  @ApiProperty({
    example:
      'Tuần này bạn duy trì ăn uống ổn định quanh 1850 kcal/ngày, giảm được 0.4 kg, đã hoàn thành 3 buổi tập. Tiếp tục phát huy nhé!',
  })
  highlightText: string;

  @ApiProperty({ example: false })
  isFallback: boolean;

  @ApiProperty({ example: '2026-09-12T10:00:00.000Z' })
  generatedAt: string;
}
