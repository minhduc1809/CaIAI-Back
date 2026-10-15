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
 * Duyệt món người dùng gửi (BR-08.5). Có thể sửa số liệu trước khi duyệt. Món vào kho nên BẮT BUỘC khai báo đủ thẻ an
 * toàn (dị ứng, 5 cờ chế độ ăn) và nhóm món: người dùng gửi không biết các thông tin này, và thiếu thẻ thì món bị loại
 * khỏi gợi ý (fail-closed).
 */
export class ApproveFoodSubmissionDto {
  @ApiProperty({ example: 'Bún - Phở - Mì' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @ApiProperty({ type: [String], description: `Mã dị ứng: ${ALLERGEN_CODES.join(', ')}; không có thì mảng rỗng` })
  @IsArray()
  @IsIn([...ALLERGEN_CODES], { each: true, message: 'Mã dị ứng không hợp lệ' })
  allergens: string[];

  @ApiProperty() @IsBoolean() containsMeat: boolean;
  @ApiProperty() @IsBoolean() containsFish: boolean;
  @ApiProperty() @IsBoolean() containsEgg: boolean;
  @ApiProperty() @IsBoolean() containsDairy: boolean;
  @ApiProperty() @IsBoolean() containsPork: boolean;

  @ApiPropertyOptional({ description: 'Sửa tên trước khi duyệt' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) servingSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5000) calories?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) protein?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) carb?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(500) fat?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  aliases?: string[];

  @ApiPropertyOptional({ description: 'Nguồn số liệu; mặc định ghi là món do người dùng đóng góp, đã được admin rà soát' })
  @IsOptional() @IsString() @MaxLength(240) dataSource?: string;
}

export class RejectFoodSubmissionDto {
  @ApiProperty({ example: 'Số liệu calo không khớp nhãn sản phẩm' })
  @IsString()
  @IsNotEmpty({ message: 'Phải ghi lý do từ chối' })
  @MaxLength(300)
  reason: string;
}
