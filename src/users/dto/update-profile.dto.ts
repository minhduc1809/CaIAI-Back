import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, GoalType, ActivityLevel } from '@prisma/client';

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

  @ApiPropertyOptional({ example: 68.5, description: 'Cân nặng (kg)' })
  @IsOptional()
  @IsNumber({}, { message: 'Cân nặng phải là số' })
  @Min(20, { message: 'Cân nặng tối thiểu 20 kg' })
  @Max(300, { message: 'Cân nặng tối đa 300 kg' })
  weightKg?: number;

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

  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh', description: 'Múi giờ' })
  @IsOptional()
  @IsString()
  timezone?: string;
}
