import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Giá trị phải là bội của 0,5 (ví dụ RPE 7, 7.5, 8). Không dùng IsDivisibleBy của class-validator vì nó làm tròn số chia
 * (0,5 thành 0) nên từ chối mọi giá trị.
 */
export function IsHalfStep(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isHalfStep',
      target: object.constructor,
      propertyName,
      options: { message: 'Giá trị phải tính theo bước 0,5', ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9,
      },
    });
  };
}
