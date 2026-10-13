import { PLAN_LIMITS } from '../billing/billing.constants';
import { resetConfigSnapshot, setConfigSnapshot } from './config.holder';
import { CONFIG_CONSTRAINTS } from './config.registry';

describe('Hạn mức gói đọc từ tham số hệ thống (J3, AC8)', () => {
  afterEach(() => resetConfigSnapshot());

  it('mặc định giữ nguyên số cũ, null vẫn là không giới hạn', () => {
    expect(PLAN_LIMITS.FREE).toMatchObject({ aiPhotoPerDay: 5, barcodePerDay: 5, chatMessagesPerDay: 10, chatTokensPerDay: null, checkinPerMonth: 1 });
    expect(PLAN_LIMITS.PREMIUM).toMatchObject({ aiPhotoPerDay: 30, chatMessagesPerDay: null, chatTokensPerDay: 50000, checkinPerMonth: null, planPreviewDays: null });
  });

  it('đổi tham số thì lần đọc kế tiếp thấy ngay', () => {
    setConfigSnapshot(new Map([['quota.free.aiPhotoPerDay', 8]]), 1);
    expect(PLAN_LIMITS.FREE.aiPhotoPerDay).toBe(8);
  });

  it('ràng buộc: Premium không thấp hơn Free', () => {
    const c = CONFIG_CONSTRAINTS.find((x) => x.message.includes('Premium không được thấp hơn'))!;
    const get = (over: Record<string, number>) => (k: string) => over[k] ?? (k.includes('premium') ? 100 : 5);
    expect(c.ok(get({}))).toBe(true);
    expect(c.ok(get({ 'quota.premium.aiPhotoPerDay': 3 }))).toBe(false);
  });

  it('JSON của hạn mức có đủ giá trị (getter liệt kê được)', () => {
    expect(JSON.parse(JSON.stringify(PLAN_LIMITS.FREE)).aiPhotoPerDay).toBe(5);
  });
});
