import { AiService } from '../../ai/ai.service';
import { ProfileIncompleteException } from './profile-incomplete.exception';

describe('P1 Chưa có mục tiêu thì tính năng cần mục tiêu báo lỗi rõ, không bịa số', () => {
  const build = (user: any) => {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => user) },
      meal: { findMany: jest.fn(async () => []) },
      usageCounter: {
        upsert: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      subscriptionState: { findUnique: jest.fn(async () => null) },
      manualGrant: { findFirst: jest.fn(async () => null) },
    };
    return new AiService({ get: () => undefined } as any, prisma, {} as any);
  };

  it('mã lỗi PROFILE_INCOMPLETE, trạng thái 400', () => {
    const e = new ProfileIncompleteException();
    expect(e.getStatus()).toBe(400);
    expect((e.getResponse() as any).code).toBe('PROFILE_INCOMPLETE');
  });

  it('gợi ý món khi chưa có mục tiêu → PROFILE_INCOMPLETE (không gợi ý theo mục tiêu 2000 giả)', async () => {
    const service = build({ targetCalories: null, timezone: 'Asia/Ho_Chi_Minh', goal: 'MAINTAIN', allergies: [], dietType: 'OMNIVORE' });
    await expect(service.suggestMeal('u1')).rejects.toBeInstanceOf(ProfileIncompleteException);
  });

  it('mục tiêu bằng 0 cũng bị coi là chưa có', async () => {
    const service = build({ targetCalories: 0, timezone: 'Asia/Ho_Chi_Minh', goal: 'MAINTAIN', allergies: [], dietType: 'OMNIVORE' });
    await expect(service.suggestMeal('u1')).rejects.toBeInstanceOf(ProfileIncompleteException);
  });
});
