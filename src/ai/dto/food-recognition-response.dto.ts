import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FoodAlternativeDto {
  @ApiProperty({ example: 'Phở bò nạm gầu' })
  name: string;

  @ApiProperty({ example: '1 tô lớn', description: 'Khẩu phần chuẩn của món trong kho' })
  servingSize: string;

  @ApiProperty({ example: 'pho-bo-nam-gau', description: 'Định danh món trong kho' })
  sourceId: string;

  @ApiProperty({ example: 480 })
  calories: number;

  @ApiProperty({ example: 32 })
  protein: number;

  @ApiProperty({ example: 62 })
  carb: number;

  @ApiProperty({ example: 12 })
  fat: number;
}

export class FoodItemRecognitionDto {
  @ApiProperty({
    example: 'Thịt bò tái',
    description: 'Tên thành phần / món con',
  })
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

  @ApiPropertyOptional({
    enum: ['AI_MATCHED', 'AI_ESTIMATE'],
    description:
      'AI_MATCHED: số liệu lấy từ kho món × khẩu phần. AI_ESTIMATE: không có trong kho, số liệu là ước tính (hiện nhãn "Ước tính")',
  })
  sourceType?: 'AI_MATCHED' | 'AI_ESTIMATE';

  @ApiPropertyOptional({ description: 'Định danh món trong kho (chỉ có khi AI_MATCHED)' })
  sourceId?: string;

  @ApiPropertyOptional({ description: 'true khi số liệu là ước tính, không phải số liệu kho' })
  isEstimate?: boolean;

  @ApiPropertyOptional({ example: 0.9, description: 'Độ tin cậy nhận diện của AI (0–1)' })
  confidence?: number;

  @ApiPropertyOptional({ enum: ['HIGH', 'LOW'] })
  confidenceLevel?: 'HIGH' | 'LOW';

  @ApiPropertyOptional({ description: 'true khi calo ước tính đã được sửa theo 4P+4C+9F vì lệch > 15%' })
  atwaterAdjusted?: boolean;

  @ApiPropertyOptional({
    type: [FoodAlternativeDto],
    description: 'Tối đa 3 món gần nhất trong kho để người dùng đổi khi AI nhận sai',
  })
  alternatives?: FoodAlternativeDto[];
}

export class FoodRecognitionResultDto {
  @ApiProperty({
    example: 'Phở bò tái nạm',
    description: 'Tên món ăn chính được nhận diện',
  })
  foodName: string;

  @ApiProperty({ example: 0.95, description: 'Độ tin cậy của AI (0.0 - 1.0)' })
  confidenceScore: number;

  @ApiProperty({
    example: '1 tô vừa (~450g)',
    description: 'Khẩu phần ước tính',
  })
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
    example:
      'Món ăn giàu protein từ thịt bò và carb phức hợp từ bánh phở. Nên hạn chế húp hết nước béo nếu đang trong giai đoạn giảm mỡ.',
    description: 'Lời khuyên dinh dưỡng từ AI Coach',
  })
  healthTip: string;

  @ApiProperty({
    example: false,
    description: 'Cờ đánh dấu kết quả thực từ Gemini API hay Fallback Engine',
  })
  isFallback: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tên các món AI thấy nhưng không ước tính được số liệu (người dùng tự tìm trong kho món)',
  })
  unrecognized?: string[];

  @ApiProperty({
    example: 'FREE',
    enum: ['FREE', 'PURCHASED'],
    description:
      'Lượt nhận diện vừa sử dụng: FREE (5 lượt miễn phí hàng ngày) hoặc PURCHASED (lượt mua thêm)',
    required: false,
  })
  usedQuotaType?: 'FREE' | 'PURCHASED';

  @ApiProperty({
    example: 4,
    description: 'Số lượt miễn phí còn lại trong ngày hôm nay',
    required: false,
  })
  freeRemaining?: number;

  @ApiProperty({
    example: 10,
    description: 'Số lượt mua thêm còn lại (không hết hạn)',
    required: false,
  })
  purchasedCredits?: number;

  @ApiProperty({
    example: 14,
    description: 'Tổng số lượt chụp ảnh AI còn lại hiện có',
    required: false,
  })
  totalRemaining?: number;

  @ApiProperty({
    example: 14,
    description: 'Alias tổng số lượt chụp ảnh còn lại',
    required: false,
  })
  remainingDailyQuota?: number;

  @ApiProperty({
    example: 5,
    description: 'Giới hạn số lượt chụp ảnh miễn phí mỗi ngày',
    required: false,
  })
  dailyLimit?: number;
}
