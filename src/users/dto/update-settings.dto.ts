import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ENERGY_UNITS, HEIGHT_UNITS, WEIGHT_UNITS } from '../user-settings';

/** Cập nhật cài đặt cá nhân (BR-19.4). Mọi trường tuỳ chọn; kiểm tra chi tiết nằm ở `validateSettingsPatch`. */
export class UpdateSettingsDto {
  @ApiPropertyOptional({ enum: WEIGHT_UNITS })
  @IsOptional()
  @IsIn([...WEIGHT_UNITS], { message: 'Đơn vị cân nặng phải là kg hoặc lb' })
  weightUnit?: string;

  @ApiPropertyOptional({ enum: HEIGHT_UNITS })
  @IsOptional()
  @IsIn([...HEIGHT_UNITS], { message: 'Đơn vị chiều cao phải là cm hoặc ft' })
  heightUnit?: string;

  @ApiPropertyOptional({ enum: ENERGY_UNITS })
  @IsOptional()
  @IsIn([...ENERGY_UNITS], { message: 'Đơn vị năng lượng phải là kcal hoặc kJ' })
  energyUnit?: string;

  @ApiPropertyOptional({ nullable: true, example: '21:00', description: 'Giờ nhắc "ghi đủ hôm nay" (HH:mm), null để tắt' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  dailyCompletionReminder?: string | null;

  @ApiPropertyOptional({ example: 90, description: 'Thời gian nghỉ mặc định giữa set (giây)' })
  @IsOptional()
  @IsInt({ message: 'Thời gian nghỉ phải là số nguyên' })
  defaultRestSec?: number;

  @ApiPropertyOptional({ example: { WEEKLY_SUMMARY_READY: false }, description: 'Bật/tắt từng loại thông báo; thông báo thanh toán luôn gửi' })
  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, boolean>;

  @ApiPropertyOptional({ description: 'Đánh dấu app đã đẩy cài đặt cũ trên máy lên server (di trú một lần)' })
  @IsOptional()
  @IsBoolean()
  initialized?: boolean;
}
