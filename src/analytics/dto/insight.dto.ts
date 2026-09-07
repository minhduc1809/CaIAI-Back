import { ApiProperty } from '@nestjs/swagger';

export class InsightDto {
  @ApiProperty({ enum: ['PLATEAU', 'GOAL_DEVIATION'] })
  type: 'PLATEAU' | 'GOAL_DEVIATION';

  @ApiProperty()
  message: string;
}
