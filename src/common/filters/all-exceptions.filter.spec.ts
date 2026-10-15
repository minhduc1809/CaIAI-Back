import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { QuotaExceededException } from '../errors/quota-exceeded.exception';

/** Chạy bộ lọc với một lỗi và trả về phần thân JSON gửi cho app. */
function run(exception: unknown) {
  let status = 0;
  let body: any;
  const res: any = {
    status: (s: number) => {
      status = s;
      return { json: (b: any) => (body = b) };
    },
  };
  const host: any = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/v1/x' }) }),
  };
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe('Bộ lọc lỗi toàn cục giữ mã lỗi cho app', () => {
  it('lỗi có cấu trúc: trả code cùng các trường kèm theo trong details, vẫn giữ trường cũ', () => {
    const { status, body } = run(
      new ServiceUnavailableException({
        statusCode: 503,
        code: 'AI_UNAVAILABLE',
        message: 'AI tạm thời không khả dụng.',
        error: 'Service Unavailable',
      }),
    );
    expect(status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      statusCode: 503,
      message: 'AI tạm thời không khả dụng.',
      error: 'Service Unavailable',
      code: 'AI_UNAVAILABLE',
      path: '/api/v1/x',
    });
    expect(body.details).toBeUndefined();
  });

  it('hết hạn mức: app nhận được code, feature, limit, resetsAt để mở màn nâng cấp', () => {
    const { status, body } = run(
      new QuotaExceededException({
        feature: 'AI_COACH',
        limit: 10,
        used: 10,
        period: 'day',
        resetsAt: new Date('2026-10-12T17:00:00.000Z'),
        isPremium: false,
      }),
    );
    expect(status).toBe(429);
    expect(body.code).toBe('QUOTA_EXCEEDED');
    expect(body.details).toMatchObject({
      feature: 'AI_COACH',
      limit: 10,
      used: 10,
      period: 'day',
      upgrade: true,
      resetsAt: '2026-10-12T17:00:00.000Z',
    });
    // Các trường đã có ở mức trên không bị lặp trong details
    expect(body.details.code).toBeUndefined();
    expect(body.details.message).toBeUndefined();
    expect(body.details.statusCode).toBeUndefined();
  });

  it('NOT_FOOD (400) có mã riêng để app hiện hướng dẫn chụp lại', () => {
    const { body } = run(
      new BadRequestException({ statusCode: 400, code: 'NOT_FOOD', message: 'Không thấy món ăn', error: 'Bad Request' }),
    );
    expect(body.code).toBe('NOT_FOOD');
    expect(body.message).toBe('Không thấy món ăn');
  });

  it('lỗi thường không có code thì không thêm trường thừa (tương thích cũ)', () => {
    const { body } = run(new ForbiddenException('Không có quyền'));
    expect(body.message).toBe('Không có quyền');
    expect('code' in body).toBe(false);
    expect('details' in body).toBe(false);
  });

  it('lỗi kiểm tra dữ liệu đầu vào: message là mảng, không có code', () => {
    const { body } = run(new BadRequestException(['name should not be empty', 'age must be a number']));
    expect(body.message).toEqual(['name should not be empty', 'age must be a number']);
    expect('code' in body).toBe(false);
  });

  it('lỗi không phải HttpException trả 500 và không lộ chi tiết nội bộ ngoài message', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body.message).toBe('boom');
    expect('code' in body).toBe(false);
  });

  it('chuỗi thuần vẫn hoạt động', () => {
    const { status, body } = run(new HttpException('Quá nhiều', 429));
    expect(status).toBe(429);
    expect(body.message).toBe('Quá nhiều');
  });
});
