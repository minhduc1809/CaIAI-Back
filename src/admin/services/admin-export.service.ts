import { BadRequestException, Injectable } from '@nestjs/common';
import { toCsv } from '../csv.util';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService } from './admin-users.service';
import { AdminPaymentsService } from './admin-payments.service';
import { AdminFoodsService } from './admin-foods.service';
import { AdminExercisesService } from './admin-exercises.service';
import { AdminDataRequestsService } from './admin-data-requests.service';
import { AdminRevenueService } from './admin-revenue.service';
import type { AdminActor } from './admin-foods.service';

export const EXPORT_KINDS = ['users', 'orders', 'revenue', 'foods', 'exercises', 'audit', 'data-requests'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Giới hạn số dòng một lần xuất, tránh kéo cả bảng lớn qua một request. */
const MAX_ROWS = 10_000;
const PAGE = 100;
const MAX_PREVIEW = 10;

interface Col { key: string; label: string; get: (row: any) => unknown }
const col = (key: string, label: string, get: (row: any) => unknown): Col => ({ key, label, get });

const premiumEnd = (u: any): Date | undefined =>
  [u.subscriptionState?.expiryTime, u.manualGrants?.[0]?.endsAt].filter((d): d is Date => !!d && d > new Date()).sort((a, b) => b.getTime() - a.getTime())[0];

/**
 * DANH SÁCH TRƯỜNG ĐƯỢC PHÉP XUẤT cho từng loại dữ liệu. Không bao giờ có token, mật khẩu, dữ liệu xác thực hay dữ liệu sức
 * khỏe cá nhân; thêm trường mới là một quyết định có chủ đích ở đây.
 */
const COLUMNS: Record<Exclude<ExportKind, 'revenue'>, Col[]> = {
  users: [
    col('email', 'Email', (u) => u.email),
    col('name', 'Tên', (u) => u.name),
    col('role', 'Vai trò', (u) => u.role),
    col('status', 'Trạng thái', (u) => (u.isActive ? 'Hoạt động' : 'Đã khoá')),
    col('emailVerified', 'Đã xác thực email', (u) => (u.isEmailVerified ? 'Có' : 'Chưa')),
    col('plan', 'Gói', (u) => (premiumEnd(u) ? 'Premium' : 'Free')),
    col('premiumEnd', 'Hết hạn Premium', (u) => premiumEnd(u) ?? ''),
    col('createdAt', 'Ngày đăng ký', (u) => u.createdAt),
  ],
  orders: [
    col('code', 'Mã nội dung CK', (o) => o.code),
    col('email', 'Email', (o) => o.user?.email),
    col('productId', 'Gói', (o) => o.productId),
    col('amount', 'Số tiền (VND)', (o) => o.amount),
    col('status', 'Trạng thái', (o) => o.status),
    col('createdAt', 'Tạo lúc', (o) => o.createdAt),
    col('expiresAt', 'Hết hạn', (o) => o.expiresAt),
    col('paidAt', 'Thanh toán lúc', (o) => o.paidAt),
    col('adminNote', 'Ghi chú nội bộ', (o) => o.adminNote),
  ],
  foods: [
    col('name', 'Tên món', (f) => f.name),
    col('category', 'Nhóm', (f) => f.category),
    col('servingSize', 'Khẩu phần', (f) => f.servingSize),
    col('calories', 'kcal', (f) => f.calories),
    col('protein', 'Đạm (g)', (f) => f.protein),
    col('carb', 'Tinh bột (g)', (f) => f.carb),
    col('fat', 'Béo (g)', (f) => f.fat),
    col('allergens', 'Dị ứng', (f) => f.allergens.join(';')),
    col('containsMeat', 'Có thịt', (f) => f.containsMeat),
    col('containsFish', 'Có cá', (f) => f.containsFish),
    col('containsEgg', 'Có trứng', (f) => f.containsEgg),
    col('containsDairy', 'Có sữa', (f) => f.containsDairy),
    col('containsPork', 'Có thịt heo', (f) => f.containsPork),
    col('source', 'Nguồn', (f) => f.source),
    col('dataSource', 'Nguồn số liệu', (f) => f.dataSource),
    col('isActive', 'Hiển thị', (f) => f.isActive),
    col('needsReview', 'Cần rà soát', (f) => f.needsReview),
  ],
  exercises: [
    col('name', 'Tên bài', (e) => e.name),
    col('targetMuscle', 'Nhóm cơ', (e) => e.targetMuscle),
    col('level', 'Mức độ', (e) => e.level),
    col('equipment', 'Dụng cụ', (e) => e.equipment),
    col('genderTarget', 'Giới', (e) => e.genderTarget),
    col('sets', 'Số hiệp', (e) => e.data?.sets),
    col('repsOrDuration', 'Số lần/thời gian', (e) => e.data?.repsOrDuration),
    col('restSeconds', 'Nghỉ (giây)', (e) => e.data?.restSeconds),
    col('calories', 'Calo/hiệp', (e) => e.data?.caloriesBurnedEstimate),
    col('isActive', 'Hiển thị', (e) => e.isActive),
  ],
  // Không xuất trước/sau để không mang dữ liệu chi tiết ra ngoài hệ thống
  audit: [
    col('createdAt', 'Thời gian', (l) => l.createdAt),
    col('adminEmail', 'Admin', (l) => l.adminEmail),
    col('action', 'Hành động', (l) => l.action),
    col('targetType', 'Loại đối tượng', (l) => l.targetType),
    col('targetId', 'Mã đối tượng', (l) => l.targetId),
    col('reason', 'Lý do', (l) => l.reason),
  ],
  'data-requests': [
    col('email', 'Email', (r) => r.email),
    col('type', 'Loại', (r) => r.type),
    col('status', 'Trạng thái', (r) => r.status),
    col('createdAt', 'Nhận lúc', (r) => r.createdAt),
    col('dueAt', 'Hạn xử lý', (r) => r.dueAt),
    col('handledAt', 'Xử lý lúc', (r) => r.handledAt),
    col('resultNote', 'Ghi chú xử lý', (r) => r.resultNote),
  ],
};

/**
 * Xuất CSV phía máy chủ (BR-17.4). Áp đúng bộ lọc người dùng đang xem, chỉ các trường được phép (người dùng chọn tập con
 * và thứ tự), có xem trước vài dòng, mọi lần xuất đều ghi nhật ký.
 */
@Injectable()
export class AdminExportService {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly users: AdminUsersService,
    private readonly payments: AdminPaymentsService,
    private readonly foods: AdminFoodsService,
    private readonly exercises: AdminExercisesService,
    private readonly dataRequests: AdminDataRequestsService,
    private readonly revenue: AdminRevenueService,
  ) {}

  /** Các trường có thể xuất của một loại dữ liệu. */
  fields(kind: string) {
    this.assertKind(kind);
    if (kind === 'revenue') return [{ key: 'all', label: 'Báo cáo đối soát (cố định)' }];
    return COLUMNS[kind as Exclude<ExportKind, 'revenue'>].map(({ key, label }) => ({ key, label }));
  }

  private assertKind(kind: string): asserts kind is ExportKind {
    if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Loại dữ liệu xuất không hợp lệ');
  }

  /** Đọc lần lượt từng trang cho tới hết hoặc chạm giới hạn. */
  private async collect<T>(fetchPage: (page: number) => Promise<{ items: T[]; total: number }>, max: number): Promise<{ rows: T[]; truncated: boolean }> {
    const rows: T[] = [];
    let total = Infinity;
    for (let page = 1; rows.length < Math.min(total, max); page++) {
      const r = await fetchPage(page);
      total = r.total;
      if (r.items.length === 0) break;
      rows.push(...r.items);
    }
    return { rows: rows.slice(0, max), truncated: total > max };
  }

  private async rowsFor(kind: Exclude<ExportKind, 'revenue'>, q: Record<string, string | undefined>, max: number) {
    switch (kind) {
      case 'users':
        return this.collect(async (page) => {
          const res = await this.users.getUsers({ ...q, page, limit: PAGE } as never);
          return { items: res.data.items, total: res.data.pagination.total };
        }, max);
      case 'orders':
        return this.collect(async (page) => {
          const res = await this.payments.getOrders({ ...q, page, limit: PAGE } as never);
          return { items: res.data.items, total: res.data.pagination.total };
        }, max);
      case 'foods':
        return this.collect(async (page) => {
          const res = await this.foods.list({
            query: q.query, category: q.category, status: q.status, source: q.source, missingTags: q.missingTags === 'true',
            needsReview: q.needsReview === 'true', sort: q.sort, order: q.order, page, limit: PAGE,
          });
          return { items: res.items, total: res.total };
        }, max);
      case 'exercises':
        return this.collect(async (page) => {
          const res = await this.exercises.list({
            query: q.query, level: q.level, status: q.status, muscle: q.muscle, equipment: q.equipment, gender: q.gender,
            sort: q.sort, order: q.order, page, limit: PAGE,
          });
          return { items: res.items, total: res.total };
        }, max);
      case 'audit':
        return this.collect(async (page) => {
          const res = await this.audit.getAuditLogs({ ...q, page, limit: PAGE } as never);
          return { items: res.data.items, total: res.data.pagination.total };
        }, max);
      default:
        return this.collect(async (page) => {
          const res = await this.dataRequests.list({ status: q.status, type: q.type, from: q.from, to: q.to, page, limit: PAGE });
          return { items: res.items, total: res.total };
        }, max);
    }
  }

  private pickColumns(kind: Exclude<ExportKind, 'revenue'>, fieldsParam?: string): Col[] {
    const all = COLUMNS[kind];
    if (!fieldsParam) return all;
    const wanted = fieldsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const picked = wanted.map((k) => all.find((c) => c.key === k)).filter((c): c is Col => !!c);
    if (picked.length === 0) throw new BadRequestException('Chưa chọn trường hợp lệ nào để xuất');
    return picked;
  }

  /** Xem trước vài dòng đầu theo đúng bộ lọc và trường đã chọn (không ghi nhật ký vì không xuất file). */
  async preview(kind: string, q: Record<string, string | undefined>) {
    this.assertKind(kind);
    if (kind === 'revenue') return { headers: ['Báo cáo đối soát'], rows: [], note: 'Báo cáo doanh thu có cấu trúc cố định.' };
    const cols = this.pickColumns(kind, q.fields);
    const { rows } = await this.rowsFor(kind, q, MAX_PREVIEW);
    return { headers: cols.map((c) => c.label), rows: rows.map((r) => cols.map((c) => String(c.get(r) ?? ''))) };
  }

  async build(actor: AdminActor, kind: string, q: Record<string, string | undefined>): Promise<{ csv: string; name: string; truncated: boolean }> {
    this.assertKind(kind);
    let csv: string;
    let truncated = false;
    let rowCount: number | undefined;
    let fields: string[] | undefined;

    if (kind === 'revenue') {
      csv = await this.revenue.exportCsv(q.from, q.to);
    } else {
      const cols = this.pickColumns(kind, q.fields);
      const res = await this.rowsFor(kind, q, MAX_ROWS);
      truncated = res.truncated;
      rowCount = res.rows.length;
      fields = cols.map((c) => c.key);
      csv = toCsv(cols.map((c) => c.label), res.rows.map((r) => cols.map((c) => c.get(r))));
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'EXPORT_DATA',
      targetType: 'Export',
      targetId: kind,
      after: { rows: rowCount, truncated, fields, filters: Object.keys(q).filter((k) => q[k] && k !== 'fields') },
    });
    return { csv, name: `${kind}-${stamp}.csv`, truncated };
  }
}
