import * as bcrypt from 'bcrypt';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { previousRange, resolveRange } from './services/admin-analytics.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminPaymentsService } from './services/admin-payments.service';
import { AdminReauthService } from './services/admin-reauth.service';
import { csvCell, toCsv } from './csv.util';
import { requestMetrics } from '../common/metrics/request-metrics';

describe('Khoảng thời gian phân tích', () => {
  const now = new Date('2026-10-13T05:00:00Z');
  it('mặc định 30 ngày tính đến hôm nay (giờ Việt Nam)', () => {
    expect(resolveRange(undefined, undefined, now)).toEqual({ from: '2026-09-14', to: '2026-10-13', days: 30 });
  });
  it('kỳ trước có cùng độ dài, liền kề', () => {
    const r = resolveRange('2026-10-01', '2026-10-07', now);
    expect(previousRange(r)).toEqual({ from: '2026-09-24', to: '2026-09-30', days: 7 });
  });
  it('từ chối khoảng quá dài, đảo ngược, sai định dạng', () => {
    expect(() => resolveRange('2026-01-01', '2026-10-13', now)).toThrow('tối đa');
    expect(() => resolveRange('2026-10-13', '2026-10-01', now)).toThrow(BadRequestException);
    expect(() => resolveRange('13/10/2026', undefined, now)).toThrow('YYYY-MM-DD');
  });
});

describe('CSV xuất dữ liệu', () => {
  it('chống formula injection và escape ngoặc kép', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('bình thường')).toBe('"bình thường"');
    expect(csvCell(null)).toBe('""');
  });
  it('có BOM cho tiếng Việt', () => {
    expect(toCsv(['a'], [['b']]).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('Số đo vận hành', () => {
  beforeEach(() => requestMetrics.reset());
  it('không lưu chuỗi truy vấn và định danh trong đường dẫn lỗi', () => {
    requestMetrics.recordError('GET', '/api/v1/admin/users/3f2c1b2a-1111-4222-8333-444455556666?email=a@b.c', 'boom');
    const snap = requestMetrics.snapshot();
    expect(snap.recentErrors[0].path).toBe('/api/v1/admin/users/:id');
    expect(snap.errors5xx24h).toBe(1);
  });
  it('tính trung bình và p95', () => {
    [10, 20, 30, 40, 100].forEach((ms) => requestMetrics.recordRequest(ms, 200));
    const s = requestMetrics.snapshot();
    expect(s.requests).toBe(5);
    expect(s.avgMs).toBe(40);
    expect(s.p95Ms).toBe(100);
  });
});

describe('Xác thực lại và thao tác nhạy cảm', () => {
  const hash = bcrypt.hashSync('Admin@12345', 4);
  function build(user: any = { id: 'u1', email: 'u@x.vn', role: 'USER', isActive: true }) {
    const audits: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'admin' ? { password: hash } : where.id === user.id ? user : null)),
        update: jest.fn(async () => ({})),
      },
      refreshSession: { updateMany: jest.fn(async () => ({ count: 2 })) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const reauth = new AdminReauthService(prisma);
    const audit: any = { logAction: jest.fn(async (a: any) => audits.push(a)) };
    return { svc: new AdminUsersService(prisma, audit, reauth), prisma, audits, reauth };
  }
  const actor = { id: 'admin', email: 'a@x.vn' };

  it('khoá tài khoản: cần lý do ≥ 10 ký tự và đúng mật khẩu, thu hồi phiên, ghi nhật ký', async () => {
    const t = build();
    await expect(t.svc.lock(actor, 'u1', { reason: 'ngắn', password: 'Admin@12345' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.lock(actor, 'u1', { reason: 'Vi phạm điều khoản sử dụng' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(t.svc.lock(actor, 'u1', { reason: 'Vi phạm điều khoản sử dụng', password: 'sai' })).rejects.toBeInstanceOf(ForbiddenException);
    await t.svc.lock(actor, 'u1', { reason: 'Vi phạm điều khoản sử dụng', password: 'Admin@12345' });
    expect(t.prisma.refreshSession.updateMany).toHaveBeenCalled();
    expect(t.audits[0]).toMatchObject({ action: 'LOCK_USER', targetId: 'u1', after: { isActive: false } });
  });

  it('không khoá được tài khoản admin; khoá hai lần báo xung đột', async () => {
    const adminTarget = build({ id: 'x', email: 'x', role: 'ADMIN', isActive: true });
    await expect(adminTarget.svc.lock(actor, 'x', { reason: 'Không được phép', password: 'Admin@12345' })).rejects.toBeInstanceOf(BadRequestException);
    const locked = build({ id: 'u1', email: 'u', role: 'USER', isActive: false });
    await expect(locked.svc.lock(actor, 'u1', { reason: 'Đã khoá rồi mà', password: 'Admin@12345' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('duyệt đơn QR cần mật khẩu khi chạy qua API quản trị', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ password: hash })) },
      paymentOrder: { findUnique: jest.fn(async () => ({ id: 'o1', code: 'NW1', status: 'PENDING' })) },
    };
    const payments: any = { adminApprove: jest.fn(async () => ({ ok: true })) };
    const audit: any = { logAction: jest.fn() };
    const svc = new AdminPaymentsService(prisma, payments, audit, new AdminReauthService(prisma));
    await expect(svc.approveOrder('admin', 'a@x.vn', 'o1', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.adminApprove).not.toHaveBeenCalled();
    await svc.approveOrder('admin', 'a@x.vn', 'o1', { password: 'Admin@12345', note: 'Đã đối chiếu sao kê' });
    expect(payments.adminApprove).toHaveBeenCalled();
  });
});

describe('Nhập CSV bài tập: videoUrl', () => {
  const head = 'name,targetMuscle,level,equipment,genderTarget,sets,repsOrDuration,restSeconds,caloriesBurnedEstimate,preparation,execution,commonMistakes,breathing';
  const row = (v: string) => `${head},videoUrl\nPlank,Core,BEGINNER,NO_EQUIPMENT,ALL,3,30s,45,12,a,b,c,d,${v}`;
  it('nhận link https và bỏ qua khi trống', () => {
    const { validateCsvExercises } = require('./exercise-csv');
    expect(validateCsvExercises(row('https://www.youtube.com/watch?v=abc')).rows[0].videoUrl).toBe('https://www.youtube.com/watch?v=abc');
    expect(validateCsvExercises(row('')).rows[0].videoUrl).toBeUndefined();
  });
  it('từ chối link không phải https', () => {
    const { validateCsvExercises } = require('./exercise-csv');
    const r = validateCsvExercises(row('http://example.com/v'));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain('videoUrl');
  });
});
