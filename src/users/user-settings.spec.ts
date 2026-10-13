import { BadRequestException } from '@nestjs/common';
import { isNotificationDisabled, validateSettingsPatch } from './user-settings';
import { NotificationsService } from '../notifications/notifications.service';

describe('Cài đặt cá nhân (BR-19.4)', () => {
  it('nhận đơn vị và giờ nhắc hợp lệ', () => {
    const d = validateSettingsPatch({ weightUnit: 'lb', heightUnit: 'ft', energyUnit: 'kJ', dailyCompletionReminder: '08:30', defaultRestSec: 120 }, {});
    expect(d).toEqual({ weightUnit: 'lb', heightUnit: 'ft', energyUnit: 'kJ', dailyCompletionReminder: '08:30', defaultRestSec: 120 });
  });

  it('null tắt nhắc "ghi đủ hôm nay"', () => {
    expect(validateSettingsPatch({ dailyCompletionReminder: null }, {})).toEqual({ dailyCompletionReminder: null });
  });

  it('"OFF" cũng tắt nhắc', () => {
    expect(validateSettingsPatch({ dailyCompletionReminder: 'OFF' }, {})).toEqual({ dailyCompletionReminder: null });
  });

  it.each([
    [{ weightUnit: 'stone' }],
    [{ heightUnit: 'm' }],
    [{ energyUnit: 'cal' }],
    [{ dailyCompletionReminder: '24:00' }],
    [{ dailyCompletionReminder: '9:00' }],
    [{ defaultRestSec: 5 }],
    [{ defaultRestSec: 601 }],
    [{ defaultRestSec: 90.5 }],
  ])('từ chối %j', (patch) => {
    expect(() => validateSettingsPatch(patch as any, {})).toThrow(BadRequestException);
  });

  it('chỉ lưu loại thông báo đã tắt; bật lại thì bỏ khỏi danh sách', () => {
    let prefs = validateSettingsPatch({ notificationPrefs: { WEEKLY_SUMMARY_READY: false, GOAL_REACHED: false } }, {}).notificationPrefs as Record<string, boolean>;
    expect(prefs).toEqual({ WEEKLY_SUMMARY_READY: false, GOAL_REACHED: false });
    prefs = validateSettingsPatch({ notificationPrefs: { GOAL_REACHED: true } }, prefs).notificationPrefs as Record<string, boolean>;
    expect(prefs).toEqual({ WEEKLY_SUMMARY_READY: false });
  });

  it('thông báo thanh toán không tắt được; loại lạ và giá trị sai bị từ chối', () => {
    expect(() => validateSettingsPatch({ notificationPrefs: { BILLING_ISSUE: false } }, {})).toThrow('thanh toán');
    expect(() => validateSettingsPatch({ notificationPrefs: { NOPE: false } }, {})).toThrow('không hợp lệ');
    expect(() => validateSettingsPatch({ notificationPrefs: { GOAL_REACHED: 'no' as any } }, {})).toThrow(BadRequestException);
  });

  it('isNotificationDisabled: BILLING_ISSUE luôn được gửi', () => {
    expect(isNotificationDisabled({ GOAL_REACHED: false }, 'GOAL_REACHED')).toBe(true);
    expect(isNotificationDisabled({ GOAL_REACHED: false }, 'CHECKIN_READY')).toBe(false);
    expect(isNotificationDisabled({ BILLING_ISSUE: false }, 'BILLING_ISSUE')).toBe(false);
    expect(isNotificationDisabled(null, 'GOAL_REACHED')).toBe(false);
  });
});

describe('H3: server không tạo thông báo loại đã tắt', () => {
  function build(prefs: unknown) {
    const created: any[] = [];
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ notificationPrefs: prefs })) },
      notification: { create: jest.fn(async ({ data }: any) => (created.push(data), data)) },
    };
    return { svc: new NotificationsService(prisma), created };
  }

  it('loại đã tắt không được tạo', async () => {
    const { svc, created } = build({ WEEKLY_SUMMARY_READY: false });
    expect(await svc.create('u1', 'WEEKLY_SUMMARY_READY' as any, 't', 'm')).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('loại còn bật và thông báo thanh toán vẫn được tạo', async () => {
    const { svc, created } = build({ WEEKLY_SUMMARY_READY: false, BILLING_ISSUE: false });
    await svc.create('u1', 'GOAL_REACHED' as any, 't', 'm');
    await svc.create('u1', 'BILLING_ISSUE' as any, 't', 'm');
    expect(created.map((c) => c.type)).toEqual(['GOAL_REACHED', 'BILLING_ISSUE']);
  });
});
