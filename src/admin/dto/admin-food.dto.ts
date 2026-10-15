import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ALLERGEN_CODES } from '../../recommendations/data/food-safety-tags.data';

/**
 * Tạo món trong kho (BR-08.1). Thẻ an toàn BẮT BUỘC và phải khai báo tường minh (kể cả "không có chất gây dị ứng"):
 * bỏ sót thẻ làm món bị loại khỏi mọi gợi ý (fail-closed), nên API không cho tạo món thiếu thẻ.
 */
export class AdminCreateFoodDto {
  @ApiProperty({ example: 'Bánh xèo' })
  @IsString()
  @IsNotEmpty({ message: 'Tên món không được để trống' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Bún - Phở - Mì' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @ApiProperty({ example: '1 cái (150g)', description: 'Khẩu phần chuẩn mà số liệu dinh dưỡng áp dụng' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  servingSize: string;

  @ApiProperty({ example: 400, description: 'kcal cho một khẩu phần chuẩn (0–5000)' })
  @IsNumber()
  @Min(0)
  @Max(5000)
  calories: number;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(0)
  @Max(500)
  protein: number;

  @ApiProperty({ example: 40 })
  @IsNumber()
  @Min(0)
  @Max(500)
  carb: number;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(0)
  @Max(500)
  fat: number;

  @ApiPropertyOptional({ example: 'Bánh xèo miền Tây, nhân tôm thịt' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;

  @ApiPropertyOptional({ type: [String], example: ['bánh xèo tôm thịt'], description: 'Tên gọi khác, tối đa 10' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];

  @ApiPropertyOptional({
    example: [{ name: 'tô vừa', grams: 500, isDefault: true }],
    description: 'Đơn vị khẩu phần (BR-08.2): tên, số gram/ml của một đơn vị, đơn vị mặc định',
  })
  @IsOptional()
  @IsArray()
  units?: { name: string; grams: number; isDefault?: boolean }[];

  @ApiPropertyOptional({ description: 'Đánh dấu món chưa được chuyên gia rà soát số liệu' })
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;

  @ApiProperty({
    type: [String],
    example: ['SHELLFISH'],
    description: `Chất gây dị ứng, chỉ nhận các mã: ${ALLERGEN_CODES.join(', ')}. Không có thì gửi mảng rỗng.`,
  })
  @IsArray()
  @IsIn([...ALLERGEN_CODES], { each: true, message: 'Mã dị ứng không hợp lệ' })
  allergens: string[];

  @ApiProperty() @IsBoolean() containsMeat: boolean;
  @ApiProperty() @IsBoolean() containsFish: boolean;
  @ApiProperty() @IsBoolean() containsEgg: boolean;
  @ApiProperty() @IsBoolean() containsDairy: boolean;
  @ApiProperty() @IsBoolean() containsPork: boolean;

  @ApiProperty({
    example: 'Bảng thành phần thực phẩm Việt Nam, Viện Dinh dưỡng 2017',
    description: 'Nguồn số liệu dinh dưỡng của món (bắt buộc ghi rõ)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phải ghi rõ nguồn số liệu của món' })
  @MaxLength(240)
  dataSource: string;
}

/** Sửa món: mọi trường tuỳ chọn, nhưng các cờ an toàn phải gửi đủ cả bộ nếu sửa một trong số chúng. */
export class AdminUpdateFoodDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) servingSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5000) calories?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) protein?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) carb?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) fat?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) note?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];

  @ApiPropertyOptional({ description: 'Đơn vị khẩu phần [{name, grams, isDefault}]' })
  @IsOptional()
  @IsArray()
  units?: { name: string; grams: number; isDefault?: boolean }[];

  @ApiPropertyOptional({ description: 'Đánh dấu/bỏ đánh dấu cần rà soát' })
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn([...ALLERGEN_CODES], { each: true, message: 'Mã dị ứng không hợp lệ' })
  allergens?: string[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() containsMeat?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() containsFish?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() containsEgg?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() containsDairy?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() containsPork?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(240) dataSource?: string;
  @ApiPropertyOptional({ description: 'false = ẩn món khỏi mọi tính năng (không xoá hẳn để giữ lịch sử)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
