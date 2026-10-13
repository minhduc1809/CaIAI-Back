import * as bcrypt from 'bcrypt';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { CONFIG_REGISTRY, validateConfigValue } from './config.registry';
import { cfg, configVersion, resetConfigSnapshot } from './config.holder';
import { NUTRITION_LIMITS } from '../users/health-calculator.service';

function build() {
  const rows = new Map<string, any>();
  const history: any[] = [];
  const audits: any[] = [];
  const hash = bcrypt.hashSync('Admin@12345', 4);
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ password: hash })) },
    systemConfig: {
      findMany: jest.fn(async () => [...rows.values()]),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.key) ?? null),
      delete: jest.fn(async ({ where }: any) => rows.delete(where.key)),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const cur = rows.get(where.key);
        const row = cur ? { ...cur, ...update, updatedAt: new Date() } : { ...create, updatedAt: new Date() };
        rows.set(where.key, row);
        return row;
      }),
    },
    systemConfigHistory: {
      findFirst: jest.fn(async () => (history.length ? history[history.length - 1] : null)),
      findMany: jest.fn(async ({ where }: any = {}) => history.filter((h) => !where?.key || h.key === where.key).reverse()),
      findUnique: jest.fn(async ({ where }: any) => history.find((h) => h.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `h${history.length + 1}`, createdAt: new Date(), ...data };
        history.push(row);
        return row;
      }),
    },
  };
  const audit: any = { logAction: jest.fn(async (a: any) => audits.push(a)) };
  return { svc: new SystemConfigService(prisma, audit), rows, history, audits };
}

const admin = { id: 'a1', email: 'admin@x.vn' };
const REASON = 'Điều chỉnh theo khuyến nghị chuyên gia';

describe('Tham số hệ thống (BR-19.2)', () => {
  beforeEach(() => resetConfigSnapshot());
  afterEach(() => resetConfigSnapshot());

  it('mặc định nằm trong code: chưa ghi đè thì trả mặc định', () => {
    expect(cfg('checkin.maxChangePct')).toBe(10);
    expect(NUTRITION_LIMITS.calorieFloorFemale).toBe(1200);
  });

  it('mọi tham số có mặc định nằm trong [min, max]', () => {
    for (const def of CONFIG_REGISTRY) {
      expect(validateConfigValue(def, def.default).error).toBeUndefined();
    }
  });

  it('AC1: sàn calo nữ 900 bị từ chối (dưới giới hạn cứng)', async () => {
    const { svc } = build();
    await expect(svc.set(admin, 'nutrition.calorieFloorFemale', 900, REASON, 'Admin@12345')).rejects.toBeInstanceOf(BadRequestException);
    expect(cfg('nutrition.calorieFloorFemale')).toBe(1200);
  });

  it('AC3: đổi checkin.maxChangePct 10 → 8 có hiệu lực ngay cho lần tính sau, ghi lịch sử và tăng phiên bản', async () => {
    const { svc, history, audits } = build();
    const r = await svc.set(admin, 'checkin.maxChangePct', 8, REASON);
    expect(r.configVersion).toBe(1);
    expect(cfg('checkin.maxChangePct')).toBe(8);
    expect(configVersion()).toBe(1);
    expect(history[0]).toMatchObject({ key: 'checkin.maxChangePct', oldValue: null, newValue: 8, adminId: 'a1', reason: REASON });
    expect(audits[0]).toMatchObject({ action: 'CONFIG_SET', targetId: 'checkin.maxChangePct' });
  });

  it('bắt buộc lý do ≥ 10 ký tự', async () => {
    const { svc } = build();
    await expect(svc.set(admin, 'checkin.maxChangePct', 8, 'ngắn')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reset(admin, 'checkin.maxChangePct', '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tham số an toàn cần nhập lại mật khẩu đúng', async () => {
    const { svc } = build();
    await expect(svc.set(admin, 'nutrition.calorieFloorFemale', 1100, REASON)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.set(admin, 'nutrition.calorieFloorFemale', 1100, REASON, 'sai')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.set(admin, 'nutrition.calorieFloorFemale', 1100, REASON, 'Admin@12345');
    expect(NUTRITION_LIMITS.calorieFloorFemale).toBe(1100);
  });

  it('từ chối kiểu dữ liệu sai, số lẻ cho số nguyên, khoá không tồn tại', async () => {
    const { svc } = build();
    await expect(svc.set(admin, 'checkin.snoozeHours', 2.5, REASON)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.set(admin, 'checkin.snoozeHours', 'abc' as any, REASON)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.set(admin, 'khong.ton.tai', 1, REASON)).rejects.toThrow('Không có tham số');
  });

  it('ràng buộc chéo: calo một món không được vượt calo một bữa', async () => {
    const { svc } = build();
    await svc.set(admin, 'meal.maxMealKcal', 12000, REASON);
    await expect(svc.set(admin, 'meal.maxItemKcal', 13000, REASON)).rejects.toThrow('meal.maxMealKcal');
    // hạ calo một bữa xuống dưới calo một món cũng bị chặn
    const { svc: svc2 } = build();
    await svc2.set(admin, 'meal.maxItemKcal', 9000, REASON);
    await expect(svc2.set(admin, 'meal.maxMealKcal', 5000, REASON)).rejects.toThrow('meal.maxMealKcal');
  });

  it('về mặc định xoá ghi đè và ghi lịch sử', async () => {
    const { svc, rows, history } = build();
    await svc.set(admin, 'checkin.snoozeHours', 12, REASON);
    await svc.reset(admin, 'checkin.snoozeHours', 'Quay về mặc định theo kế hoạch');
    expect(rows.has('checkin.snoozeHours')).toBe(false);
    expect(cfg('checkin.snoozeHours')).toBe(24);
    expect(history[1]).toMatchObject({ action: 'RESET', oldValue: 12, newValue: null });
    expect(configVersion()).toBe(2);
  });

  it('khôi phục là một lần sửa mới (có lý do, tăng phiên bản)', async () => {
    const { svc, history } = build();
    await svc.set(admin, 'checkin.snoozeHours', 12, REASON);
    await svc.set(admin, 'checkin.snoozeHours', 6, REASON);
    await svc.restore(admin, history[1].id, 'Hoàn tác thay đổi nhầm');
    expect(cfg('checkin.snoozeHours')).toBe(12);
    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({ action: 'RESTORE', configVersion: 3 });
  });

  it('danh sách trả mặc định, giá trị hiện tại, giới hạn và cờ ghi đè', async () => {
    const { svc } = build();
    await svc.set(admin, 'checkin.maxChangePct', 8, REASON);
    const list = await svc.list();
    const item = list.items.find((i: any) => i.key === 'checkin.maxChangePct')!;
    expect(item).toMatchObject({ default: 10, value: 8, isOverridden: true, min: 3, max: 20 });
    expect(list.items.find((i: any) => i.key === 'checkin.snoozeHours')!.isOverridden).toBe(false);
  });

  it('lỗi DB khi nạp thì giữ giá trị đang dùng', async () => {
    const { svc } = build();
    await svc.set(admin, 'checkin.maxChangePct', 8, REASON);
    (svc as any).prisma.systemConfig.findMany = jest.fn(async () => {
      throw new Error('db down');
    });
    await svc.refresh();
    expect(cfg('checkin.maxChangePct')).toBe(8);
  });
});

describe('AC5: không còn hằng số nghiệp vụ rải rác trong các file đã chuyển', () => {
  it('các file đã nối tham số không còn hằng số cũ', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    expect(read('checkins/checkins.service.ts')).not.toMatch(/const (SMOOTHING_LIMIT_RATIO|SNOOZE_HOURS|NO_CHANGE_THRESHOLD_KCAL) =/);
    expect(read('meals/meals.service.ts')).not.toMatch(/const (MAX_ITEM_KCAL|MAX_MEAL_KCAL|DEDUPE_WINDOW_MS) =/);
    expect(read('analytics/analytics.service.ts')).not.toMatch(/const (PLATEAU_WEEKS|GOAL_DEVIATION_WEEKS|MIN_COMPLETE_DAYS_PER_WEEK) =/);
  });
});
