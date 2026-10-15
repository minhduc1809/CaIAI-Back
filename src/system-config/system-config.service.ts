import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from '../admin/services/admin-audit.service';
import {
  CONFIG_BY_KEY,
  CONFIG_CONSTRAINTS,
  CONFIG_REGISTRY,
  ConfigDef,
  validateConfigValue,
} from './config.registry';
import { cfg, configVersion, setConfigSnapshot } from './config.holder';

export const MIN_REASON_LENGTH = 10;

interface Actor {
  id: string;
  email?: string;
}

/**
 * Tham số hệ thống (BR-19.2): admin sửa được mà không cần deploy. Bảng chỉ lưu giá trị bị ghi đè; xoá ghi đè là về
 * mặc định trong code. Mọi thay đổi bắt buộc lý do, ghi lịch sử + nhật ký kiểm toán và tăng `configVersion`. Đổi tham
 * số KHÔNG hồi tố: chỉ áp cho lần tính sau (BR-19.2, NT1).
 */
@Injectable()
export class SystemConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemConfigService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async onModuleInit() {
    await this.refresh();
    const schedule = () => {
      this.timer = setTimeout(async () => {
        await this.refresh();
        schedule();
      }, cfg('config.cacheSec') * 1000);
      this.timer.unref?.();
    };
    schedule();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Nạp lại giá trị ghi đè từ DB. Lỗi DB thì giữ nguyên giá trị đang dùng (không làm hỏng dịch vụ). */
  async refresh(): Promise<void> {
    try {
      const [rows, last] = await Promise.all([
        this.prisma.systemConfig.findMany(),
        this.prisma.systemConfigHistory.findFirst({ orderBy: { configVersion: 'desc' }, select: { configVersion: true } }),
      ]);
      const map = new Map<string, number | boolean>();
      for (const r of rows) {
        const def = CONFIG_BY_KEY.get(r.key);
        if (!def) continue; // khoá đã bị gỡ khỏi danh mục
        const ok = validateConfigValue(def, r.value);
        if (ok.value !== undefined) map.set(r.key, ok.value);
        else this.logger.warn(`Bỏ qua giá trị không hợp lệ của ${r.key} trong DB, dùng mặc định`);
      }
      setConfigSnapshot(map, last?.configVersion ?? 0);
    } catch (e) {
      this.logger.error(`Không nạp được tham số hệ thống: ${(e as Error).message}`);
    }
  }

  private view(def: ConfigDef, overrideValue: unknown, updatedAt?: Date | null, updatedBy?: string | null) {
    const overridden = overrideValue !== undefined;
    return {
      key: def.key,
      group: def.group,
      type: def.type,
      unit: def.unit ?? null,
      description: def.description,
      min: def.min ?? null,
      max: def.max ?? null,
      default: def.default,
      value: overridden ? overrideValue : def.default,
      isOverridden: overridden,
      isSafetyCritical: def.safetyCritical === true,
      updatedAt: updatedAt ?? null,
      updatedBy: updatedBy ?? null,
    };
  }

  async list() {
    const rows = await this.prisma.systemConfig.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      configVersion: configVersion(),
      items: CONFIG_REGISTRY.map((def) => {
        const row = byKey.get(def.key);
        return this.view(def, row ? row.value : undefined, row?.updatedAt, row?.updatedBy);
      }),
    };
  }

  /** Tham số cần cho app hiển thị (không gồm tham số quản trị). */
  async publicConfig() {
    const keys = ['workout.abandonedSessionHours', 'checkin.snoozeHours', 'food.atwaterWarnPct', 'meal.maxItemKcal'];
    return { configVersion: configVersion(), values: Object.fromEntries(keys.map((k) => [k, cfg(k)])) };
  }

  private requireReason(reason: unknown): string {
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (r.length < MIN_REASON_LENGTH) {
      throw new BadRequestException(`Phải ghi lý do thay đổi (ít nhất ${MIN_REASON_LENGTH} ký tự)`);
    }
    return r;
  }

  /** Kiểm tra ràng buộc chéo trên bộ giá trị sau khi áp thay đổi (key → giá trị mới, hoặc undefined = về mặc định). */
  private async assertConstraints(change: { key: string; value: number | boolean | undefined }) {
    const rows = await this.prisma.systemConfig.findMany();
    const current = new Map<string, number | boolean>();
    for (const r of rows) {
      const def = CONFIG_BY_KEY.get(r.key);
      if (def && validateConfigValue(def, r.value).value !== undefined) current.set(r.key, r.value as number | boolean);
    }
    if (change.value === undefined) current.delete(change.key);
    else current.set(change.key, change.value);
    const get = (k: string): number => {
      const def = CONFIG_BY_KEY.get(k)!;
      const v = current.has(k) ? current.get(k)! : def.default;
      return typeof v === 'boolean' ? (v ? 1 : 0) : v;
    };
    for (const c of CONFIG_CONSTRAINTS) {
      if (!c.ok(get)) throw new BadRequestException(c.message);
    }
  }

  private async nextVersion(): Promise<number> {
    const last = await this.prisma.systemConfigHistory.findFirst({ orderBy: { configVersion: 'desc' }, select: { configVersion: true } });
    return (last?.configVersion ?? 0) + 1;
  }

  /** Ghi một thay đổi (đặt giá trị hoặc về mặc định) cùng lịch sử và nhật ký kiểm toán. */
  private async apply(
    actor: Actor,
    def: ConfigDef,
    next: number | boolean | undefined,
    reason: string,
    action: 'SET' | 'RESET' | 'RESTORE',
  ) {
    await this.assertConstraints({ key: def.key, value: next });
    const existing = await this.prisma.systemConfig.findUnique({ where: { key: def.key } });
    const oldValue = existing ? (existing.value as number | boolean) : null;
    const version = await this.nextVersion();

    if (next === undefined) {
      if (existing) await this.prisma.systemConfig.delete({ where: { key: def.key } });
    } else {
      await this.prisma.systemConfig.upsert({
        where: { key: def.key },
        update: { value: next, updatedBy: actor.id },
        create: { key: def.key, value: next, updatedBy: actor.id },
      });
    }
    await this.prisma.systemConfigHistory.create({
      data: {
        key: def.key,
        action,
        oldValue: oldValue as any,
        newValue: (next === undefined ? null : next) as any,
        adminId: actor.id,
        adminEmail: actor.email ?? null,
        reason,
        configVersion: version,
      },
    });
    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: `CONFIG_${action}`,
      targetType: 'SystemConfig',
      targetId: def.key,
      before: { value: oldValue },
      after: { value: next === undefined ? def.default : next },
      reason,
    });
    // Hiệu lực ngay trên instance này; các instance khác nhận sau tối đa `config.cacheSec`
    await this.refresh();
    return { key: def.key, configVersion: version, value: next === undefined ? def.default : next };
  }

  private defOrThrow(key: string): ConfigDef {
    const def = CONFIG_BY_KEY.get(key);
    if (!def) throw new NotFoundException(`Không có tham số "${key}"`);
    return def;
  }

  /** Sửa tham số an toàn phải nhập lại mật khẩu của chính admin (BR-17.1, BR-19.2). */
  private async assertReauth(actor: Actor, def: ConfigDef, password?: string) {
    if (!def.safetyCritical) return;
    if (!password) throw new ForbiddenException('Tham số an toàn: cần nhập lại mật khẩu để xác nhận');
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { password: true } });
    const ok = !!user?.password && (await bcrypt.compare(password, user.password));
    if (!ok) throw new ForbiddenException('Mật khẩu xác nhận không đúng');
  }

  async set(actor: Actor, key: string, value: unknown, reason: unknown, password?: string) {
    const def = this.defOrThrow(key);
    const r = this.requireReason(reason);
    await this.assertReauth(actor, def, password);
    const v = validateConfigValue(def, value);
    if (v.error) throw new BadRequestException(v.error);
    return this.apply(actor, def, v.value, r, 'SET');
  }

  async reset(actor: Actor, key: string, reason: unknown, password?: string) {
    const def = this.defOrThrow(key);
    await this.assertReauth(actor, def, password);
    return this.apply(actor, def, undefined, this.requireReason(reason), 'RESET');
  }

  async history(key?: string, limit = 50) {
    const items = await this.prisma.systemConfigHistory.findMany({
      where: key ? { key } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return { items };
  }

  /** Khôi phục về giá trị ĐÃ CÓ trước một bản ghi lịch sử: cũng là một lần sửa mới (có lý do, tăng phiên bản). */
  async restore(actor: Actor, historyId: string, reason: unknown, password?: string) {
    const entry = await this.prisma.systemConfigHistory.findUnique({ where: { id: historyId } });
    if (!entry) throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    const def = this.defOrThrow(entry.key);
    await this.assertReauth(actor, def, password);
    const r = this.requireReason(reason);
    // oldValue null nghĩa là trước đó đang dùng mặc định
    if (entry.oldValue === null || entry.oldValue === undefined) return this.apply(actor, def, undefined, r, 'RESTORE');
    const v = validateConfigValue(def, entry.oldValue);
    if (v.error) throw new BadRequestException(`Giá trị cũ không còn hợp lệ: ${v.error}`);
    return this.apply(actor, def, v.value, r, 'RESTORE');
  }
}
