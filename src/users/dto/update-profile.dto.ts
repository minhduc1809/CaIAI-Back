import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  Gender,
  GoalType,
  ActivityLevel,
  MacroStyle,
  StressLevel,
  DietType,
  FoodBudgetLevel,
} from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn A', description: 'Họ và tên người dùng' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png', description: 'Link ảnh đại diện' })
  @IsOptional()
  @IsUrl({}, { message: 'Avatar phải là URL hợp lệ' })
  avatar?: string;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE, description: 'Giới tính' })
  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ (MALE, FEMALE, OTHER)' })
  gender?: Gender;

  @ApiPropertyOptional({ example: '2000-01-15', description: 'Ngày sinh (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh phải đúng định dạng YYYY-MM-DD' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 175, description: 'Chiều cao (cm)' })
  @IsOptional()
  @IsNumber({}, { message: 'Chiều cao phải là số' })
  @Min(50, { message: 'Chiều cao tối thiểu 50 cm' })
  @Max(250, { message: 'Chiều cao tối đa 250 cm' })
  heightCm?: number;

  @ApiPropertyOptional({ example: 68.5, description: 'Cân nặng hiện tại (kg)' })
  @IsOptional()
  @IsNumber({}, { message: 'Cân nặng phải là số' })
  @Min(20, { message: 'Cân nặng tối thiểu 20 kg' })
  @Max(300, { message: 'Cân nặng tối đa 300 kg' })
  weightKg?: number;

  @ApiPropertyOptional({ example: 62.0, description: 'Cân nặng mục tiêu (kg)' })
  @IsOptional()
  @IsNumber({}, { message: 'Cân nặng mục tiêu phải là số' })
  @Min(20, { message: 'Cân nặng mục tiêu tối thiểu 20 kg' })
  @Max(300, { message: 'Cân nặng mục tiêu tối đa 300 kg' })
  targetWeightKg?: number;

  @ApiPropertyOptional({ example: 0.5, description: 'Tốc độ tăng/giảm cân (kg/tuần): 0.25, 0.5, 0.75, 1.0' })
  @IsOptional()
  @IsNumber({}, { message: 'Tốc độ phải là số' })
  @Min(0.1, { message: 'Tốc độ tối thiểu 0.1 kg/tuần' })
  @Max(1.5, { message: 'Tốc độ tối đa 1.5 kg/tuần' })
  weightRateKgPerWeek?: number;

  @ApiPropertyOptional({ example: 18.5, description: 'Tỷ lệ mỡ cơ thể (%)' })
  @IsOptional()
  @IsNumber({}, { message: 'Tỷ lệ mỡ phải là số' })
  @Min(3, { message: 'Tỷ lệ mỡ tối thiểu 3%' })
  @Max(60, { message: 'Tỷ lệ mỡ tối đa 60%' })
  bodyFatPercent?: number;

  @ApiPropertyOptional({
    enum: ActivityLevel,
    example: ActivityLevel.MODERATELY_ACTIVE,
    description: 'Mức độ vận động',
  })
  @IsOptional()
  @IsEnum(ActivityLevel, { message: 'Mức độ vận động không hợp lệ' })
  activityLevel?: ActivityLevel;

  @ApiPropertyOptional({
    enum: GoalType,
    example: GoalType.LOSE_WEIGHT,
    description: 'Mục tiêu dinh dưỡng',
  })
  @IsOptional()
  @IsEnum(GoalType, { message: 'Mục tiêu không hợp lệ (LOSE_WEIGHT, MAINTAIN, GAIN_WEIGHT)' })
  goal?: GoalType;

  @ApiPropertyOptional({
    enum: MacroStyle,
    example: MacroStyle.BALANCED,
    description: 'Trường phái phân bổ Macro (BALANCED, HIGH_CARB_LOW_FAT, LOW_CARB_HIGH_FAT, KETO)',
  })
  @IsOptional()
  @IsEnum(MacroStyle, { message: 'Trường phái Macro không hợp lệ' })
  macroStyle?: MacroStyle;

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh', description: 'Múi giờ' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 7.5, description: 'Số giờ ngủ trung bình mỗi đêm' })
  @IsOptional()
  @IsNumber({}, { message: 'Số giờ ngủ phải là số' })
  @Min(0, { message: 'Số giờ ngủ tối thiểu 0' })
  @Max(24, { message: 'Số giờ ngủ tối đa 24' })
  sleepHours?: number;

  @ApiPropertyOptional({ enum: StressLevel, example: StressLevel.MEDIUM, description: 'Mức độ stress' })
  @IsOptional()
  @IsEnum(StressLevel, { message: 'Mức độ stress không hợp lệ (LOW, MEDIUM, HIGH)' })
  stressLevel?: StressLevel;

  @ApiPropertyOptional({ example: false, description: 'Có sử dụng thực phẩm bổ sung (supplements) hay không' })
  @IsOptional()
  @IsBoolean({ message: 'takesSupplements phải là boolean' })
  takesSupplements?: boolean;

  @ApiPropertyOptional({ enum: DietType, example: DietType.BALANCED, description: 'Loại chế độ ăn' })
  @IsOptional()
  @IsEnum(DietType, { message: 'Loại chế độ ăn không hợp lệ' })
  dietType?: DietType;

  @ApiPropertyOptional({ example: 3, description: 'Số bữa ăn mỗi ngày' })
  @IsOptional()
  @IsNumber({}, { message: 'Số bữa ăn phải là số' })
  @Min(1, { message: 'Tối thiểu 1 bữa/ngày' })
  @Max(10, { message: 'Tối đa 10 bữa/ngày' })
  mealsPerDay?: number;

  @ApiPropertyOptional({ example: 30, description: 'Thời gian nấu ăn có sẵn (phút)' })
  @IsOptional()
  @IsNumber({}, { message: 'Thời gian nấu ăn phải là số' })
  @Min(0, { message: 'Thời gian nấu ăn tối thiểu 0 phút' })
  @Max(300, { message: 'Thời gian nấu ăn tối đa 300 phút' })
  cookTimeMinutes?: number;

  @ApiPropertyOptional({ enum: FoodBudgetLevel, example: FoodBudgetLevel.MEDIUM, description: 'Mức ngân sách ăn uống' })
  @IsOptional()
  @IsEnum(FoodBudgetLevel, { message: 'Mức ngân sách không hợp lệ (LOW, MEDIUM, HIGH)' })
  foodBudgetLevel?: FoodBudgetLevel;
}
