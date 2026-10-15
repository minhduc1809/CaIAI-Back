import { BadRequestException } from '@nestjs/common';

/**
 * Cài đặt cá nhân đồng bộ trên server (BR-19.4). Người dùng không chỉnh được hạn mức AI hay sàn calo ở đây; giao diện
 * (theme, kiểu hiển thị bữa ăn) chỉ lưu trên máy.
 */
export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export const HEIGHT_UNITS = ['cm', 'ft'] as const;
export const ENERGY_UNITS = ['kcal', 'kJ'] as const;

export const REST_SEC_MIN = 15;
export const REST_SEC_MAX = 600;

/** Loại thông báo luôn gửi, không tắt được (thông báo thanh toán). */
export const ALWAYS_ON_NOTIFICATIONS = ['BILLING_ISSUE', 'PAYMENT_SUCCESS'] as const;

/** Các loại thông báo lưu trên server mà người dùng được tắt/bật. */
export const TOGGLEABLE_NOTIFICATIONS = [
  'CHECKIN_READY',
  'DAY_COMPLETED',
  'WEEKLY_SUMMARY_READY',
  'FOOD_SUBMISSION_RESULT',
  'GOAL_REACHED',
  'WORKOUT_REMINDER',
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface UserSettings {
  weightUnit: string;
  heightUnit: string;
  energyUnit: string;
  timezone: string;
  checkinDay: number;
  /** "HH:mm" hoặc null khi tắt nhắc "ghi đủ hôm nay". */
  dailyCompletionReminder: string | null;
  defaultRestSec: number;
  /** Mỗi loại thông báo: true (mặc định) hoặc false. Chỉ liệt kê loại đã tắt. */
  notificationPrefs: Record<string, boolean>;
  /** false: app chưa đẩy cài đặt cũ trên máy lên server (di trú một lần). */
  initialized: boolean;
}

export interface SettingsPatch {
  weightUnit?: string;
  heightUnit?: string;
  energyUnit?: string;
  dailyCompletionReminder?: string | null;
  defaultRestSec?: number;
  notificationPrefs?: Record<string, unknown>;
}

/** Kiểm tra và chuẩn hoá phần cập nhật; trả dữ liệu để ghi vào bảng User. */
export function validateSettingsPatch(
  patch: SettingsPatch,
  currentPrefs: Record<string, boolean>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.weightUnit !== undefined) {
    if (!(WEIGHT_UNITS as readonly string[]).includes(patch.weightUnit)) throw new BadRequestException('Đơn vị cân nặng phải là kg hoặc lb');
    data.weightUnit = patch.weightUnit;
  }
  if (patch.heightUnit !== undefined) {
    if (!(HEIGHT_UNITS as readonly string[]).includes(patch.heightUnit)) throw new BadRequestException('Đơn vị chiều cao phải là cm hoặc ft');
    data.heightUnit = patch.heightUnit;
  }
  if (patch.energyUnit !== undefined) {
    if (!(ENERGY_UNITS as readonly string[]).includes(patch.energyUnit)) throw new BadRequestException('Đơn vị năng lượng phải là kcal hoặc kJ');
    data.energyUnit = patch.energyUnit;
  }
  if (patch.dailyCompletionReminder !== undefined) {
    // null hoặc "OFF" là tắt nhắc (client không gửi được null qua JSON mặc định)
    const r = patch.dailyCompletionReminder === 'OFF' ? null : patch.dailyCompletionReminder;
    if (r !== null && !HHMM.test(r)) {
      throw new BadRequestException('Giờ nhắc phải có dạng HH:mm (00:00 đến 23:59), hoặc OFF/null để tắt');
    }
    data.dailyCompletionReminder = r;
  }
  if (patch.defaultRestSec !== undefined) {
    const v = patch.defaultRestSec;
    if (!Number.isInteger(v) || v < REST_SEC_MIN || v > REST_SEC_MAX) {
      throw new BadRequestException(`Thời gian nghỉ mặc định phải là số nguyên từ ${REST_SEC_MIN} đến ${REST_SEC_MAX} giây`);
    }
    data.defaultRestSec = v;
  }
  if (patch.notificationPrefs !== undefined) {
    const next = { ...currentPrefs };
    for (const [type, enabled] of Object.entries(patch.notificationPrefs)) {
      if ((ALWAYS_ON_NOTIFICATIONS as readonly string[]).includes(type)) {
        throw new BadRequestException('Thông báo thanh toán luôn được gửi, không tắt được');
      }
      if (!(TOGGLEABLE_NOTIFICATIONS as readonly string[]).includes(type)) {
        throw new BadRequestException(`Loại thông báo không hợp lệ: ${type}`);
      }
      if (typeof enabled !== 'boolean') throw new BadRequestException(`Giá trị của ${type} phải là true hoặc false`);
      // Chỉ lưu loại đã tắt; bật lại là bỏ khỏi danh sách
      if (enabled) delete next[type];
      else next[type] = false;
    }
    data.notificationPrefs = next;
  }
  return data;
}

/** Loại thông báo này có đang bị người dùng tắt không (thông báo thanh toán không bao giờ bị tắt). */
export function isNotificationDisabled(prefs: unknown, type: string): boolean {
  if ((ALWAYS_ON_NOTIFICATIONS as readonly string[]).includes(type)) return false;
  return !!prefs && typeof prefs === 'object' && (prefs as Record<string, unknown>)[type] === false;
}
