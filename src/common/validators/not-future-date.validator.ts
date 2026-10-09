import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Chuỗi chỉ có ngày (YYYY-MM-DD) không mang múi giờ: ở Việt Nam (UTC+7) đã sang ngày mới trong khi UTC chưa qua,
 * nên cho phép lệch tối đa 14 giờ (múi giờ lớn nhất, UTC+14) để không từ chối nhầm ngày hôm nay của người dùng.
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY_MAX_AHEAD_MS = 14 * 60 * 60 * 1000;

/** Sai lệch đồng hồ cho phép giữa thiết bị và máy chủ (phút). */
const CLOCK_SKEW_MINUTES = 10;

/**
 * Giá trị ngày (chuỗi ISO) không được nằm trong tương lai (BR-09.3, BR-10.4).
 * Cho phép lệch đồng hồ nhỏ giữa thiết bị và máy chủ.
 */
export function IsNotFutureDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Ngày không được nằm trong tương lai',
        ...options,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          const t = new Date(value as string).getTime();
          if (Number.isNaN(t)) return false;
          const allowance =
            typeof value === 'string' && DATE_ONLY_RE.test(value)
              ? DATE_ONLY_MAX_AHEAD_MS
              : CLOCK_SKEW_MINUTES * 60 * 1000;
          return t <= Date.now() + allowance;
        },
      },
    });
  };
}
