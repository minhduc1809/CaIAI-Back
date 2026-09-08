import { ApiProperty } from '@nestjs/swagger';

export class NutritionGapDto {
  @ApiProperty({ example: 650, description: 'Calo còn thiếu hôm nay (kcal)' })
  remainingCalories: number;

  @ApiProperty({ example: 45, description: 'Protein còn thiếu (g)' })
  remainingProtein: number;

  @ApiProperty({ example: 60, description: 'Carbs còn thiếu (g)' })
  remainingCarbs: number;

  @ApiProperty({ example: 15, description: 'Fat còn thiếu (g)' })
  remainingFat: number;
}

export class SuggestedMealItemDto {
  @ApiProperty({ example: 'Phở gà ức ít bánh + 2 quả trứng chần' })
  name: string;

  @ApiProperty({ example: 'Bữa tối' })
  mealType: string;

  @ApiProperty({ example: 520 })
  calories: number;

  @ApiProperty({ example: 42 })
  protein: number;

  @ApiProperty({ example: 55 })
  carbs: number;

  @ApiProperty({ example: 12 })
  fat: number;

  @ApiProperty({
    example:
      'Cung cấp lượng protein tinh khiết từ ức gà và trứng, calo vừa vặn với budget tối.',
  })
  reason: string;

  @ApiProperty({
    example: ['300g phở gà ức', '2 quả trứng chần', 'Nhiều giá đỗ, rau thơm'],
    required: false,
  })
  ingredients?: string[];
}

export class SuggestMealResponseDto {
  @ApiProperty({
    type: () => NutritionGapDto,
    description: 'Tình trạng dinh dưỡng hiện tại',
  })
  nutritionGap: NutritionGapDto;

  @ApiProperty({
    type: [SuggestedMealItemDto],
    description: 'Danh sách 1-2 món ăn gợi ý',
  })
  suggestions: SuggestedMealItemDto[];

  @ApiProperty({
    example:
      'Hôm nay bạn còn thiếu 45g Protein và 650 kcal. Hãy ưu tiên bữa tối giàu đạm nhé!',
  })
  advice: string;
}
