import { ApiProperty } from '@nestjs/swagger';

export class FoodItemRecognitionDto {
  @ApiProperty({ example: 'Thịt bò tái', description: 'Tên thành phần / món con' })
  name: string;

  @ApiProperty({ example: '100g', description: 'Khẩu phần ước tính' })
  servingSize: string;

  @ApiProperty({ example: 180, description: 'Calo ước tính' })
  calories: number;

  @ApiProperty({ example: 26, description: 'Protein (g)' })
  protein: number;

  @ApiProperty({ example: 0, description: 'Carb (g)' })
  carb: number;

  @ApiProperty({ example: 8, description: 'Fat (g)' })
  fat: number;
}

export class FoodRecognitionResultDto {
  @ApiProperty({ example: 'Phở bò tái nạm', description: 'Tên món ăn chính được nhận diện' })
  foodName: string;

  @ApiProperty({ example: 0.95, description: 'Độ tin cậy của AI (0.0 - 1.0)' })
  confidenceScore: number;

  @ApiProperty({ example: '1 tô vừa (~450g)', description: 'Khẩu phần ước tính' })
  servingSize: string;

  @ApiProperty({ example: 480, description: 'Tổng lượng Calo (kcal)' })
  totalCalories: number;

  @ApiProperty({ example: 32, description: 'Tổng lượng Protein (g)' })
  totalProtein: number;

  @ApiProperty({ example: 62, description: 'Tổng lượng Carbohydrate (g)' })
  totalCarb: number;

  @ApiProperty({ example: 12, description: 'Tổng lượng Chất béo Fat (g)' })
  totalFat: number;

  @ApiProperty({
    type: [FoodItemRecognitionDto],
    description: 'Chi tiết các thành phần bóc tách được trong món ăn',
  })
  items: FoodItemRecognitionDto[];

  @ApiProperty({
    example: 'Món ăn giàu protein từ thịt bò và carb phức hợp từ bánh phở. Nên hạn chế húp hết nước béo nếu đang trong giai đoạn giảm mỡ.',
    description: 'Lời khuyên dinh dưỡng từ AI Coach',
  })
  healthTip: string;

  @ApiProperty({
    example: false,
    description: 'Cờ đánh dấu kết quả thực từ Gemini API hay Fallback Engine',
  })
  isFallback: boolean;

  @ApiProperty({
    example: 4,
    description: 'Số lượt chụp ảnh nhận diện món ăn còn lại trong ngày (tối đa 5 lượt/ngày)',
    required: false,
  })
  remainingDailyQuota?: number;

  @ApiProperty({
    example: 5,
    description: 'Giới hạn số lượt chụp ảnh món ăn tối đa mỗi ngày',
    required: false,
  })
  dailyLimit?: number;
}
