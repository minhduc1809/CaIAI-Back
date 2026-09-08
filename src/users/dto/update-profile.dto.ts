import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
  Matches,
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
  WorkoutLevel,
  TrainingGoal,
  SessionsPerWeek,
  EquipmentAccess,
  ProgramType,
  ProteinPreference,
} from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Nguyễn Văn A',
    description: 'Họ và tên người dùng',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    description: 'Link ảnh đại diện',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Avatar phải là URL hợp lệ' })
  avatar?: string;

  @ApiPropertyOptional({
    enum: Gender,
    example: Gender.MALE,
    description: 'Giới tính',
  })
  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ (MALE, FEMALE, OTHER)' })
  gender?: Gender;

  @ApiPropertyOptional({
    example: '2000-01-15',
    description: 'Ngày sinh (YYYY-MM-DD)',
  })
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

  @ApiPropertyOptional({
    example: 0.5,
    description: 'Tốc độ tăng/giảm cân (kg/tuần): 0.25, 0.5, 0.75, 1.0',
  })
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
  @IsEnum(GoalType, {
    message: 'Mục tiêu không hợp lệ (LOSE_WEIGHT, MAINTAIN, GAIN_WEIGHT)',
  })
  goal?: GoalType;

  @ApiPropertyOptional({
    enum: MacroStyle,
    example: MacroStyle.BALANCED,
    description:
      'Trường phái phân bổ Macro (BALANCED, HIGH_CARB_LOW_FAT, LOW_CARB_HIGH_FAT, KETO)',
  })
  @IsOptional()
  @IsEnum(MacroStyle, { message: 'Trường phái Macro không hợp lệ' })
  macroStyle?: MacroStyle;

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh', description: 'Múi giờ' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    example: 7.5,
    description: 'Số giờ ngủ trung bình mỗi đêm',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Số giờ ngủ phải là số' })
  @Min(0, { message: 'Số giờ ngủ tối thiểu 0' })
  @Max(24, { message: 'Số giờ ngủ tối đa 24' })
  sleepHours?: number;

  @ApiPropertyOptional({
    enum: StressLevel,
    example: StressLevel.MEDIUM,
    description: 'Mức độ stress',
  })
  @IsOptional()
  @IsEnum(StressLevel, {
    message: 'Mức độ stress không hợp lệ (LOW, MEDIUM, HIGH)',
  })
  stressLevel?: StressLevel;

  @ApiPropertyOptional({
    example: false,
    description: 'Có sử dụng thực phẩm bổ sung (supplements) hay không',
  })
  @IsOptional()
  @IsBoolean({ message: 'takesSupplements phải là boolean' })
  takesSupplements?: boolean;

  @ApiPropertyOptional({
    enum: DietType,
    example: DietType.BALANCED,
    description: 'Loại chế độ ăn',
  })
  @IsOptional()
  @IsEnum(DietType, { message: 'Loại chế độ ăn không hợp lệ' })
  dietType?: DietType;

  @ApiPropertyOptional({ example: 3, description: 'Số bữa ăn mỗi ngày' })
  @IsOptional()
  @IsNumber({}, { message: 'Số bữa ăn phải là số' })
  @Min(1, { message: 'Tối thiểu 1 bữa/ngày' })
  @Max(10, { message: 'Tối đa 10 bữa/ngày' })
  mealsPerDay?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Thời gian nấu ăn có sẵn (phút)',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Thời gian nấu ăn phải là số' })
  @Min(0, { message: 'Thời gian nấu ăn tối thiểu 0 phút' })
  @Max(300, { message: 'Thời gian nấu ăn tối đa 300 phút' })
  cookTimeMinutes?: number;

  @ApiPropertyOptional({
    enum: FoodBudgetLevel,
    example: FoodBudgetLevel.MEDIUM,
    description: 'Mức ngân sách ăn uống',
  })
  @IsOptional()
  @IsEnum(FoodBudgetLevel, {
    message: 'Mức ngân sách không hợp lệ (LOW, MEDIUM, HIGH)',
  })
  foodBudgetLevel?: FoodBudgetLevel;

  @ApiPropertyOptional({
    enum: WorkoutLevel,
    example: WorkoutLevel.BEGINNER,
    description: 'Kinh nghiệm tập luyện',
  })
  @IsOptional()
  @IsEnum(WorkoutLevel, { message: 'Kinh nghiệm tập luyện không hợp lệ' })
  trainingExperience?: WorkoutLevel;

  @ApiPropertyOptional({
    enum: TrainingGoal,
    example: TrainingGoal.GENERAL_FITNESS,
    description: 'Mục tiêu tập luyện',
  })
  @IsOptional()
  @IsEnum(TrainingGoal, { message: 'Mục tiêu tập luyện không hợp lệ' })
  trainingGoal?: TrainingGoal;

  @ApiPropertyOptional({
    enum: SessionsPerWeek,
    example: SessionsPerWeek.THREE_TO_FOUR,
    description: 'Số buổi tập mong muốn mỗi tuần',
  })
  @IsOptional()
  @IsEnum(SessionsPerWeek, { message: 'Số buổi tập mỗi tuần không hợp lệ' })
  sessionsPerWeek?: SessionsPerWeek;

  @ApiPropertyOptional({
    enum: EquipmentAccess,
    example: EquipmentAccess.BODYWEIGHT_ONLY,
    description: 'Thiết bị/nơi tập sẵn có',
  })
  @IsOptional()
  @IsEnum(EquipmentAccess, { message: 'Thiết bị tập không hợp lệ' })
  equipmentAccess?: EquipmentAccess;

  @ApiPropertyOptional({
    example: ['KNEE', 'SHOULDER'],
    description: 'Danh sách chấn thương/hạn chế vận động',
  })
  @IsOptional()
  @IsArray({ message: 'Danh sách chấn thương phải là mảng' })
  @IsString({ each: true, message: 'Mỗi mục chấn thương phải là chuỗi' })
  injuries?: string[];

  @ApiPropertyOptional({
    example: 'Đau vai phải khi nâng tạ qua đầu',
    description: 'Ghi chú chấn thương khác',
  })
  @IsOptional()
  @IsString()
  injuriesOtherNote?: string;

  @ApiPropertyOptional({ example: 80, description: '1RM Squat hiện tại (kg)' })
  @IsOptional()
  @IsNumber({}, { message: '1RM Squat phải là số' })
  @Min(0, { message: '1RM Squat tối thiểu 0' })
  @Max(500, { message: '1RM Squat tối đa 500' })
  oneRepMaxSquatKg?: number;

  @ApiPropertyOptional({
    example: 60,
    description: '1RM Bench Press hiện tại (kg)',
  })
  @IsOptional()
  @IsNumber({}, { message: '1RM Bench phải là số' })
  @Min(0, { message: '1RM Bench tối thiểu 0' })
  @Max(500, { message: '1RM Bench tối đa 500' })
  oneRepMaxBenchKg?: number;

  @ApiPropertyOptional({
    example: 100,
    description: '1RM Deadlift hiện tại (kg)',
  })
  @IsOptional()
  @IsNumber({}, { message: '1RM Deadlift phải là số' })
  @Min(0, { message: '1RM Deadlift tối thiểu 0' })
  @Max(500, { message: '1RM Deadlift tối đa 500' })
  oneRepMaxDeadliftKg?: number;

  @ApiPropertyOptional({
    enum: ProgramType,
    example: ProgramType.COACHED,
    description: 'Kiểu chương trình tập',
  })
  @IsOptional()
  @IsEnum(ProgramType, { message: 'Kiểu chương trình không hợp lệ' })
  programType?: ProgramType;

  @ApiPropertyOptional({
    enum: ProteinPreference,
    example: ProteinPreference.MID,
    description: 'Mức ưu tiên Protein',
  })
  @IsOptional()
  @IsEnum(ProteinPreference, { message: 'Mức ưu tiên Protein không hợp lệ' })
  proteinPreference?: ProteinPreference;

  @ApiPropertyOptional({
    example: false,
    description:
      'Có áp dụng nhịn ăn gián đoạn (Intermittent Fasting) hay không',
  })
  @IsOptional()
  @IsBoolean({ message: 'isIntermittentFasting phải là boolean' })
  isIntermittentFasting?: boolean;

  @ApiPropertyOptional({
    example: '12:00',
    description: 'Giờ bắt đầu khung ăn (Intermittent Fasting), định dạng HH:mm',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Định dạng giờ phải là HH:mm',
  })
  ifWindowStart?: string;

  @ApiPropertyOptional({
    example: '20:00',
    description:
      'Giờ kết thúc khung ăn (Intermittent Fasting), định dạng HH:mm',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Định dạng giờ phải là HH:mm',
  })
  ifWindowEnd?: string;
}
