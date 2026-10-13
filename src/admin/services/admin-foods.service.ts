import { normalizeUnits } from '../../food-catalog/food-units';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { FoodCatalogService } from '../../food-catalog/food-catalog.service';
import { atwaterCheck, normalizeName } from '../../ai/food-matcher';
import { AdminCreateFoodDto, AdminUpdateFoodDto } from '../dto/admin-food.dto';

const SAFETY_FLAGS = ['containsMeat', 'containsFish', 'containsEgg', 'containsDairy', 'containsPork'] as const;

export interface AdminActor {
  id: string;
  email?: string;
}

/** Quản lý kho món cho quản trị viên (BR-08.1, J2). Mọi thay đổi ghi nhật ký kiểm toán và làm mới bộ nhớ đệm kho. */
@Injectable()
export class AdminFoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly catalog: FoodCatalogService,
  ) {}

  /** Các nhóm món đang có kèm số món (để dựng bộ lọc), tính trên cả món đã ẩn. */
  async categories() {
    const rows = await this.prisma.foodCatalog.groupBy({ by: ['category'], _count: { _all: true }, orderBy: { category: 'asc' } });
    return rows.map((r) => ({ category: r.category, count: r._count._all }));
  }

  /** Tiến độ kho so với mục tiêu: chỉ đếm món thật đang hiển thị và đã gắn thẻ an toàn. */
  async progress() {
    const [active, tagged, needsReview] = await Promise.all([
      this.prisma.foodCatalog.count({ where: { isActive: true } }),
      this.prisma.foodCatalog.count({ where: { isActive: true, safetyTagged: true } }),
      this.prisma.foodCatalog.count({ where: { isActive: true, needsReview: true } }),
    ]);
    return { active, tagged, needsReview, targets: { demo: 500, release: 1000 } };
  }

  async list(params: {
    query?: string; category?: string; includeInactive?: boolean; status?: string; source?: string; missingTags?: boolean;
    needsReview?: boolean; sort?: string; order?: string; page?: number; limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const q = normalizeName(params.query ?? '');
    // `status` (active | inactive | all) thay cho includeInactive; vẫn nhận includeInactive để tương thích
    const status = params.status ?? (params.includeInactive ? 'all' : 'active');
    const where = {
      ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.source === 'OFFICIAL' || params.source === 'COMMUNITY' ? { source: params.source } : {}),
      ...(params.missingTags ? { safetyTagged: false } : {}),
      ...(params.needsReview ? { needsReview: true } : {}),
      ...(q ? { nameNormalized: { contains: q } } : {}),
    };
    const sortKey = ['name', 'calories', 'category', 'createdAt'].includes(params.sort ?? '') ? (params.sort as string) : null;
    const dir = params.order === 'desc' ? 'desc' : 'asc';
    const [total, items] = await Promise.all([
      this.prisma.foodCatalog.count({ where }),
      this.prisma.foodCatalog.findMany({
        where,
        orderBy: sortKey ? [{ [sortKey]: dir }, { name: 'asc' }] : [{ createdAt: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items };
  }

  /** Cảnh báo mềm: calo lệch quá 15% so với 4P+4C+9F (BR-08.4). Không chặn, để admin tự quyết. */
  private warningsFor(n: { calories: number; protein: number; carb: number; fat: number }): string[] {
    const check = atwaterCheck(n);
    return check.ok
      ? []
      : [`Calo (${Math.round(n.calories)}) lệch hơn 15% so với tính từ đạm/tinh bột/béo (${Math.round(check.computed)}). Hãy kiểm tra lại số liệu.`];
  }

  /** Kiểm tra danh sách đơn vị khẩu phần; mảng rỗng nghĩa là quay về đơn vị suy ra từ khẩu phần chuẩn. */
  private parseUnits(raw: unknown): unknown {
    if (raw === undefined) return undefined;
    const r = normalizeUnits(raw);
    if (r.error) throw new BadRequestException(r.error);
    return r.units && r.units.length > 0 ? r.units : null;
  }

  async create(actor: AdminActor, dto: AdminCreateFoodDto) {
    const name = dto.name.trim();
    const exists = await this.prisma.foodCatalog.findFirst({ where: { name } });
    if (exists) throw new ConflictException('Đã có món trùng tên trong kho');
    const created = await this.prisma.foodCatalog.create({
      data: {
        name,
        nameNormalized: normalizeName(name),
        aliases: (dto.aliases ?? []).map((a) => a.trim()).filter(Boolean),
        category: dto.category.trim(),
        servingSize: dto.servingSize.trim(),
        calories: dto.calories,
        protein: dto.protein,
        carb: dto.carb,
        fat: dto.fat,
        note: dto.note?.trim() || null,
        allergens: dto.allergens,
        containsMeat: dto.containsMeat,
        containsFish: dto.containsFish,
        containsEgg: dto.containsEgg,
        containsDairy: dto.containsDairy,
        containsPork: dto.containsPork,
        safetyTagged: true, // DTO bắt buộc khai báo đủ thẻ an toàn
        source: 'OFFICIAL',
        dataSource: dto.dataSource.trim(),
        needsReview: dto.needsReview ?? false,
        units: this.parseUnits(dto.units) as any,
      },
    });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'CREATE_FOOD',
      targetType: 'FoodCatalog',
      targetId: created.id,
      after: created,
    });
    return { food: created, warnings: this.warningsFor(created) };
  }

  async update(actor: AdminActor, id: string, dto: AdminUpdateFoodDto) {
    const before = await this.prisma.foodCatalog.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy món');

    // Sửa một cờ an toàn mà không gửi đủ bộ dễ làm sai thẻ: bắt phải gửi đủ cả bộ
    const touchedFlags = SAFETY_FLAGS.filter((f) => dto[f] !== undefined);
    if ((touchedFlags.length > 0 || dto.allergens !== undefined) && (touchedFlags.length !== SAFETY_FLAGS.length || dto.allergens === undefined)) {
      throw new BadRequestException('Khi sửa thẻ an toàn phải gửi đủ allergens và cả 5 cờ containsMeat/Fish/Egg/Dairy/Pork');
    }
    if (dto.name !== undefined && dto.name.trim() !== before.name) {
      const dup = await this.prisma.foodCatalog.findFirst({ where: { name: dto.name.trim(), NOT: { id } } });
      if (dup) throw new ConflictException('Đã có món trùng tên trong kho');
    }

    const data: Record<string, unknown> = {};
    if (dto.needsReview !== undefined) data.needsReview = dto.needsReview;
    for (const key of ['category', 'servingSize', 'calories', 'protein', 'carb', 'fat', 'dataSource', 'isActive', 'allergens'] as const) {
      if (dto[key] !== undefined) data[key] = typeof dto[key] === 'string' ? (dto[key] as string).trim() : dto[key];
    }
    for (const f of SAFETY_FLAGS) if (dto[f] !== undefined) data[f] = dto[f];
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
      data.nameNormalized = normalizeName(dto.name);
    }
    if (dto.note !== undefined) data.note = dto.note.trim() || null;
    if (dto.aliases !== undefined) data.aliases = dto.aliases.map((a) => a.trim()).filter(Boolean);
    if (touchedFlags.length === SAFETY_FLAGS.length) data.safetyTagged = true;
    if (dto.units !== undefined) data.units = this.parseUnits(dto.units);

    const updated = await this.prisma.foodCatalog.update({ where: { id }, data });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'UPDATE_FOOD',
      targetType: 'FoodCatalog',
      targetId: id,
      before,
      after: updated,
    });
    return { food: updated, warnings: this.warningsFor(updated) };
  }

  /** Ẩn món (không xoá hẳn): bữa đã log giữ nguyên snapshot, món biến khỏi gợi ý và tra cứu. */
  async deactivate(actor: AdminActor, id: string) {
    const before = await this.prisma.foodCatalog.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy món');
    const updated = await this.prisma.foodCatalog.update({ where: { id }, data: { isActive: false } });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'DEACTIVATE_FOOD',
      targetType: 'FoodCatalog',
      targetId: id,
      before,
      after: updated,
    });
    return { food: updated };
  }
}
