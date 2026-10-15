import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { FoodCatalogService } from '../../food-catalog/food-catalog.service';
import { normalizeName } from '../../ai/food-matcher';
import { CsvFoodRow, validateCsvFoods } from '../food-csv';
import type { AdminActor } from './admin-foods.service';

const PREVIEW_TTL_MS = 30 * 60_000;

interface Preview {
  adminId: string;
  rows: CsvFoodRow[];
  expiresAt: number;
}

/**
 * Nhập kho món bằng CSV theo hai bước (J2): xem trước (kiểm, báo lỗi từng dòng, đếm món trùng tên) rồi mới xác nhận ghi.
 * Bản xem trước giữ trong bộ nhớ 30 phút và chỉ người tạo mới xác nhận được. Dòng lỗi không chặn các dòng hợp lệ nhưng
 * admin thấy rõ trước khi xác nhận.
 */
@Injectable()
export class AdminFoodImportService {
  private readonly previews = new Map<string, Preview>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly catalog: FoodCatalogService,
  ) {}

  private sweep(now = Date.now()) {
    for (const [id, p] of this.previews) if (p.expiresAt < now) this.previews.delete(id);
  }

  async preview(actor: AdminActor, csv: string) {
    if (!csv || !csv.trim()) throw new BadRequestException('Chưa có nội dung CSV');
    const { rows, errors, total } = validateCsvFoods(csv);
    this.sweep();
    const existing = rows.length
      ? await this.prisma.foodCatalog.findMany({ where: { name: { in: rows.map((r) => r.name) } }, select: { name: true } })
      : [];
    const existingNames = new Set(existing.map((e) => e.name));
    const toCreate = rows.filter((r) => !existingNames.has(r.name));
    const importId = randomUUID();
    this.previews.set(importId, { adminId: actor.id, rows: toCreate, expiresAt: Date.now() + PREVIEW_TTL_MS });
    return {
      importId,
      total,
      valid: rows.length,
      willCreate: toCreate.length,
      skippedExisting: [...existingNames],
      errors,
      sample: toCreate.slice(0, 5).map((r) => ({ name: r.name, category: r.category, calories: r.calories })),
    };
  }

  async commit(actor: AdminActor, importId: string) {
    this.sweep();
    const p = this.previews.get(importId);
    if (!p || p.adminId !== actor.id) throw new NotFoundException('Bản xem trước không tồn tại hoặc đã hết hạn, hãy tải CSV lại');
    this.previews.delete(importId);
    const base = Date.now();
    const created = await this.prisma.foodCatalog.createMany({
      data: p.rows.map((r, i) => ({
        name: r.name,
        nameNormalized: normalizeName(r.name),
        aliases: r.aliases,
        category: r.category,
        servingSize: r.servingSize,
        calories: r.calories,
        protein: r.protein,
        carb: r.carb,
        fat: r.fat,
        note: r.note ?? null,
        allergens: r.allergens,
        containsMeat: r.containsMeat,
        containsFish: r.containsFish,
        containsEgg: r.containsEgg,
        containsDairy: r.containsDairy,
        containsPork: r.containsPork,
        safetyTagged: true, // CSV bắt buộc khai báo đủ thẻ an toàn
        source: 'OFFICIAL',
        dataSource: r.dataSource,
        createdAt: new Date(base + i),
      })),
      skipDuplicates: true,
    });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'IMPORT_FOODS',
      targetType: 'FoodCatalog',
      targetId: importId,
      after: { created: created.count, requested: p.rows.length },
    });
    return { created: created.count };
  }
}
