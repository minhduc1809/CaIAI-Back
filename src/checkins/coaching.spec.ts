import { CheckInAdjustmentReason, CheckInStatus } from '@prisma/client';
import { CheckinsService } from './checkins.service';

/** Nội dung giải thích gửi cho app phải khớp trạng thái của Check-in (BR-06.5). */
describe('Nội dung giải thích Check-in', () => {
  const svc: any = Object.create(CheckinsService.prototype);
  const ctx = { oldTarget: 2000, newTarget: 2000, newExpenditure: 2100, compliancePct: 70 };

  it('thiếu dữ liệu: nói rõ cần thêm dữ liệu, không bịa lý do "năng lượng không đổi" và không mời chấp nhận', () => {
    const c = svc.buildCoachingModule(CheckInAdjustmentReason.NO_CHANGE, {
      ...ctx,
      status: CheckInStatus.INSUFFICIENT_DATA,
    });
    expect(c.title).toBe('Chưa đủ dữ liệu để đề xuất');
    expect(c.explanation).toMatch(/cần thêm dữ liệu/i);
    expect(c.explanation).not.toMatch(/không có sự thay đổi/i);
    expect(c.callToAction).toMatch(/Đã hiểu/);
    expect(c.callToAction).not.toMatch(/Chấp nhận/);
  });

  it('có đề xuất giữ nguyên: vẫn là nội dung "mục tiêu tuần này giữ nguyên"', () => {
    const c = svc.buildCoachingModule(CheckInAdjustmentReason.NO_CHANGE, { ...ctx, status: CheckInStatus.PENDING });
    expect(c.title).toBe('Mục tiêu tuần này giữ nguyên');
  });

  it('có đề xuất thay đổi: nêu mức chênh và mời chấp nhận hoặc từ chối', () => {
    const c = svc.buildCoachingModule(CheckInAdjustmentReason.EXPENDITURE_CHANGE, {
      ...ctx,
      newTarget: 2150,
      status: CheckInStatus.PENDING,
    });
    expect(c.explanation).toContain('+150 kcal');
    expect(c.callToAction).toMatch(/Chấp nhận/);
    expect(c.callToAction).toMatch(/từ chối/);
  });

  it('không truyền status (dữ liệu cũ): hành vi như trước', () => {
    const c = svc.buildCoachingModule(CheckInAdjustmentReason.SMOOTHING, { ...ctx, newTarget: 1800 });
    expect(c.explanation).toMatch(/±10%/);
  });

  it('coaching() gửi status của Check-in vào nội dung giải thích', () => {
    const res = svc.coaching({
      status: CheckInStatus.INSUFFICIENT_DATA,
      adjustmentReason: CheckInAdjustmentReason.NO_CHANGE,
      currentCalorieTarget: 2000,
      proposedCalorieTarget: 2000,
      newExpenditure: null,
      compliancePct: null,
    });
    expect(res.coachingContent.title).toBe('Chưa đủ dữ liệu để đề xuất');
  });
});
