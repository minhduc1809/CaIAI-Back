import { ApiProperty } from '@nestjs/swagger';

export class NutritionGapDto {
  @ApiProperty({ example: 500 })
  remainingCalories: number;

  @ApiProperty({ example: 35 })
  remainingProtein: number;

  @ApiProperty({ example: 40 })
  remainingCarbs: number;

  @ApiProperty({ example: 15 })
  remainingFat: number;
}

export class SuggestedMealItemDto {
  @ApiProperty({ example: 'Phở gà ức ít bánh + 2 trứng chần' })
  name: string;

  @ApiProperty({ example: 'Bữa tối' })
  mealType: string;

  @ApiProperty({ example: 450 })
  calories: number;

  @ApiProperty({ example: 38 })
  protein: number;

  @ApiProperty({ example: 42 })
  carbs: number;

  @ApiProperty({ example: 12 })
  fat: number;

  @ApiProperty({ example: 'Bổ sung đúng lượng protein còn thiếu mà không vượt calo mục tiêu' })
  reason: string;

  @ApiProperty({ type: [String], example: ['Ức gà', 'Bánh phở', 'Trứng gà', 'Nước dùng gà'] })
  ingredients: string[];
}

export class SuggestMealResponseDto {
  @ApiProperty({ type: NutritionGapDto })
  nutritionGap: NutritionGapDto;

  @ApiProperty({ type: [SuggestedMealItemDto] })
  suggestions: SuggestedMealItemDto[];

  @ApiProperty({ example: 'Bạn còn thiếu 35g protein hôm nay, hãy ưu tiên bữa tối giàu đạm nhé!' })
  advice: string;
}
