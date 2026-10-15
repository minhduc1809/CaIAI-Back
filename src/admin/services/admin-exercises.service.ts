import { CsvExerciseRow, validateCsvExercises } from '../exercise-csv';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { ExerciseCatalogService } from '../../exercise-catalog/exercise-catalog.service';
import { normalizeName } from '../../ai/food-matcher';
import { AdminCreateExerciseDto, AdminUpdateExerciseDto } from '../dto/admin-exercise.dto';
import type { AdminActor } from './admin-foods.service';

/** Quản lý kho bài tập cho quản trị viên (F1, J2): thêm/sửa/ẩn, không xoá cứng; mọi thay đổi ghi nhật ký. */
@Injectable()
export class AdminExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly catalog: ExerciseCatalogService,
  ) {}

  async list(params: {
    query?: string; level?: string; includeInactive?: boolean; status?: string; muscle?: string; equipment?: string; gender?: string;
    sort?: string; order?: string; page?: number; limit?: number;
  }) {
    await this.catalog.ensureSeeded();
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const q = normalizeName(params.query ?? '');
    const status = params.status ?? (params.includeInactive ? 'all' : 'active');
    const where = {
      ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
      ...(params.level ? { level: params.level } : {}),
      ...(params.equipment ? { equipment: params.equipment } : {}),
      ...(params.gender ? { genderTarget: params.gender } : {}),
      ...(params.muscle?.trim() ? { targetMuscle: { contains: params.muscle.trim(), mode: 'insensitive' as const } } : {}),
      ...(q ? { nameNormalized: { contains: q } } : {}),
    };
    const sortKey = ['name', 'level', 'targetMuscle', 'createdAt'].includes(params.sort ?? '') ? (params.sort as string) : null;
    const dir = params.order === 'desc' ? 'desc' : 'asc';
    const [total, items] = await Promise.all([
      this.prisma.exerciseCatalog.count({ where }),
      this.prisma.exerciseCatalog.findMany({
        where,
        orderBy: sortKey ? [{ [sortKey]: dir }, { id: 'asc' }] : [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items };
  }

  private readonly previews = new Map<string, { adminId: string; rows: CsvExerciseRow[]; expiresAt: number }>();

  /** Nhập CSV bước 1: kiểm từng dòng, đếm bài trùng tên trong kho, chưa ghi gì. */
  async importPreview(actor: AdminActor, csv: string) {
    if (!csv?.trim()) throw new BadRequestException('Chưa có nội dung CSV');
    const { rows, errors, total } = validateCsvExercises(csv);
    for (const [id, p] of this.previews) if (p.expiresAt < Date.now()) this.previews.delete(id);
    const existing = rows.length
      ? await this.prisma.exerciseCatalog.findMany({ where: { nameNormalized: { in: rows.map((r) => normalizeName(r.name)) } }, select: { name: true, nameNormalized: true } })
      : [];
    const existingNorm = new Set(existing.map((e) => e.nameNormalized));
    const toCreate = rows.filter((r) => !existingNorm.has(normalizeName(r.name)));
    const importId = randomUUID();
    this.previews.set(importId, { adminId: actor.id, rows: toCreate, expiresAt: Date.now() + 30 * 60_000 });
    return {
      importId,
      total,
      valid: rows.length,
      willCreate: toCreate.length,
      skippedExisting: existing.map((e) => e.name),
      errors,
      sample: toCreate.slice(0, 5).map((r) => ({ name: r.name, targetMuscle: r.targetMuscle, level: r.level, equipment: r.equipment })),
    };
  }

  /** Nhập CSV bước 2: chỉ người tạo bản xem trước mới xác nhận được, một lần. */
  async importCommit(actor: AdminActor, importId: string) {
    const p = this.previews.get(importId);
    if (!p || p.adminId !== actor.id || p.expiresAt < Date.now()) throw new NotFoundException('Bản xem trước không tồn tại hoặc đã hết hạn, hãy tải CSV lại');
    this.previews.delete(importId);
    const base = Date.now();
    const created = await this.prisma.exerciseCatalog.createMany({
      data: p.rows.map((r, i) => {
        const id = `ex-${randomUUID().slice(0, 8)}`;
        const guide = { id, name: r.name, genderTarget: r.genderTarget, level: r.level, targetMuscle: r.targetMuscle, equipment: r.equipment, sets: r.sets, repsOrDuration: r.repsOrDuration, restSeconds: r.restSeconds, caloriesBurnedEstimate: r.caloriesBurnedEstimate, ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}), ...(r.videoUrl ? { videoUrl: r.videoUrl } : {}), instructions: r.instructions };
        return { id, name: r.name, nameNormalized: normalizeName(r.name), genderTarget: r.genderTarget, level: r.level, targetMuscle: r.targetMuscle, equipment: r.equipment, data: guide as any, source: 'ADMIN', createdAt: new Date(base + i) };
      }),
      skipDuplicates: true,
    });
    this.catalog.invalidate();
    await this.audit.logAction({ adminId: actor.id, adminEmail: actor.email, action: 'IMPORT_EXERCISES', targetType: 'ExerciseCatalog', targetId: importId, after: { created: created.count, requested: p.rows.length } });
    return { created: created.count };
  }

  async create(actor: AdminActor, dto: AdminCreateExerciseDto) {
    const id = `ex-${randomUUID().slice(0, 8)}`;
    const guide = {
      id,
      name: dto.name.trim(),
      genderTarget: dto.genderTarget,
      level: dto.level,
      targetMuscle: dto.targetMuscle.trim(),
      equipment: dto.equipment,
      sets: dto.sets,
      repsOrDuration: dto.repsOrDuration.trim(),
      restSeconds: dto.restSeconds,
      caloriesBurnedEstimate: dto.caloriesBurnedEstimate,
      ...(dto.imageUrl ? { imageUrl: dto.imageUrl } : {}),
      ...(dto.videoUrl ? { videoUrl: dto.videoUrl } : {}),
      instructions: dto.instructions,
    };
    const created = await this.prisma.exerciseCatalog.create({
      data: {
        id,
        name: guide.name,
        nameNormalized: normalizeName(guide.name),
        genderTarget: guide.genderTarget,
        level: guide.level,
        targetMuscle: guide.targetMuscle,
        equipment: guide.equipment,
        data: guide as any,
        source: 'ADMIN',
      },
    });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id, adminEmail: actor.email, action: 'CREATE_EXERCISE', targetType: 'ExerciseCatalog', targetId: id, after: created,
    });
    return { exercise: created };
  }

  async update(actor: AdminActor, id: string, dto: AdminUpdateExerciseDto) {
    const before = await this.prisma.exerciseCatalog.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy bài tập');
    const prev = before.data as Record<string, any>;
    const next: Record<string, any> = { ...prev };
    const columns: Record<string, unknown> = {};

    for (const key of ['genderTarget', 'level', 'equipment'] as const) {
      if (dto[key] !== undefined) {
        next[key] = dto[key];
        columns[key] = dto[key];
      }
    }
    if (dto.name !== undefined) {
      next.name = dto.name.trim();
      columns.name = next.name;
      columns.nameNormalized = normalizeName(next.name);
    }
    if (dto.targetMuscle !== undefined) {
      next.targetMuscle = dto.targetMuscle.trim();
      columns.targetMuscle = next.targetMuscle;
    }
    for (const key of ['sets', 'restSeconds', 'caloriesBurnedEstimate'] as const) {
      if (dto[key] !== undefined) next[key] = dto[key];
    }
    if (dto.repsOrDuration !== undefined) next.repsOrDuration = dto.repsOrDuration.trim();
    if (dto.imageUrl !== undefined) next.imageUrl = dto.imageUrl || undefined;
    if (dto.videoUrl !== undefined) {
      if (dto.videoUrl && !/^https:\/\/\S{3,290}$/i.test(dto.videoUrl)) throw new BadRequestException('videoUrl phải bắt đầu bằng https://');
      next.videoUrl = dto.videoUrl || undefined;
    }
    if (dto.instructions !== undefined) next.instructions = { ...(prev.instructions ?? {}), ...dto.instructions };
    if (Object.keys(columns).length === 0 && dto.isActive === undefined && Object.keys(next).every((k) => next[k] === prev[k])) {
      throw new BadRequestException('Không có thay đổi nào');
    }

    const updated = await this.prisma.exerciseCatalog.update({
      where: { id },
      data: { ...columns, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), data: next as any },
    });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id, adminEmail: actor.email, action: 'UPDATE_EXERCISE', targetType: 'ExerciseCatalog', targetId: id, before, after: updated,
    });
    return { exercise: updated };
  }

  /** Ẩn bài (không xoá cứng): buổi tập đã ghi vẫn giữ tên và số liệu. */
  async deactivate(actor: AdminActor, id: string) {
    const before = await this.prisma.exerciseCatalog.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy bài tập');
    if (!before.isActive) return { message: 'Bài tập đã được ẩn trước đó' };
    await this.prisma.exerciseCatalog.update({ where: { id }, data: { isActive: false } });
    this.catalog.invalidate();
    await this.audit.logAction({
      adminId: actor.id, adminEmail: actor.email, action: 'HIDE_EXERCISE', targetType: 'ExerciseCatalog', targetId: id, before,
    });
    return { message: 'Đã ẩn bài tập' };
  }
}
