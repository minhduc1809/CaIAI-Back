import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Kiểm soát độ tuổi người dùng (BR-02.2).
 * Ứng dụng chỉ dành cho người trưởng thành từ đủ minAge (mặc định 18) đến maxAge (mặc định 100).
 */
export function IsValidAge(
  minAge = 13,
  maxAge = 100,
  options?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidAge',
      target: object.constructor,
      propertyName,
      options: {
        message: `NutriWise dành cho người từ đủ ${minAge} tuổi đến ${maxAge} tuổi`,
        ...options,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          const birth = new Date(value as string);
          if (Number.isNaN(birth.getTime())) return false;

          const today = new Date();
          let age = today.getFullYear() - birth.getFullYear();
          const monthDiff = today.getMonth() - birth.getMonth();
          if (
            monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < birth.getDate())
          ) {
            age--;
          }

          return age >= minAge && age <= maxAge;
        },
      },
    });
  };
}
