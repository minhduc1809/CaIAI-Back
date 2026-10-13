import { WeeklySummaryService } from './weekly-summary.service';
import { dateToKey } from '../common/utils/date-zone.util';

const FAKE_DATE_ONLY = [
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'performance', 'hrtime',
] as const;
afterEach(() => jest.useRealTimers());

/** BR-11.7: tổng kết tuần dùng đúng kỳ dữ liệu của Check-in (7 ngày kết thúc hôm qua của ngày Check-in). */
describe('Kỳ dữ liệu của tổng kết tuần', () => {
  const range = async (iso: string, user: any) => {
    jest.useFakeTimers({ now: new Date(iso), doNotFake: [...FAKE_DATE_ONLY] });
    const prisma: any = { user: { findUnique: jest.fn(async () => user) } };
    const service: any = new WeeklySummaryService({ get: () => undefined } as any, prisma, {} as any);
    const r = await service.getCurrentWeekRange('u1');
    return { start: dateToKey(r.weekStartDate), end: dateToKey(r.weekEndDate) };
  };

  it('mặc định Thứ Hai: Thứ Tư 14/10 dùng 05/10 – 11/10 (không phải "Thứ Hai đến hôm nay")', async () => {
    expect(await range('2026-10-14T03:00:00Z', { timezone: 'Asia/Ho_Chi_Minh' })).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('đúng ngày Check-in: kỳ kết thúc ngày hôm qua', async () => {
    expect(await range('2026-10-12T03:00:00Z', { timezone: 'Asia/Ho_Chi_Minh', checkinDay: 1 })).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('theo ngày Check-in người dùng chọn (Thứ Tư)', async () => {
    expect(await range('2026-10-14T03:00:00Z', { timezone: 'Asia/Ho_Chi_Minh', checkinDay: 3 })).toEqual({ start: '2026-10-07', end: '2026-10-13' });
    expect(await range('2026-10-13T03:00:00Z', { timezone: 'Asia/Ho_Chi_Minh', checkinDay: 3 })).toEqual({ start: '2026-09-30', end: '2026-10-06' });
  });

  it('theo múi giờ người dùng: 00:30 sáng Thứ Hai giờ Việt Nam (còn Chủ Nhật theo UTC) đã sang kỳ mới', async () => {
    expect(await range('2026-10-11T17:30:00Z', { timezone: 'Asia/Ho_Chi_Minh', checkinDay: 1 })).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('luôn đủ 7 ngày và khớp kỳ của Check-in với mọi ngày Check-in', async () => {
    for (let day = 1; day <= 7; day++) {
      const r = await range('2026-10-14T03:00:00Z', { timezone: 'Asia/Ho_Chi_Minh', checkinDay: day });
      const days = (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000 + 1;
      expect(days).toBe(7);
    }
  });

  it('thiếu thông tin người dùng: dùng múi giờ và Thứ Hai mặc định', async () => {
    expect(await range('2026-10-14T03:00:00Z', null)).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });
});
