import { inflateRawSync } from 'zlib';
import { StreamableFile } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { crc32, createZip } from './zip';
import { csvCell, toCsv } from './csv';
import { DataExportService, PROFILE_EXCLUDED_FIELDS } from './data-export.service';
import { DataExportController } from './data-export.controller';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';

/** Bộ đọc ZIP độc lập (không dùng lại code ghi) để kiểm tra file hợp lệ. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    expect(flags & 0x0800).toBe(0x0800); // tên UTF-8
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

describe('ZIP', () => {
  it('CRC-32 đúng với giá trị chuẩn của "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('ghi rồi đọc lại đúng nội dung, kể cả tên file tiếng Việt, dữ liệu nén được và không nén được', () => {
    const compressible = Buffer.from('abc'.repeat(5000));
    const incompressible = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919 + 13) % 256));
    const zip = createZip([
      { name: 'bữa-ăn.csv', data: compressible },
      { name: 'ngẫu-nhiên.bin', data: incompressible },
      { name: 'rỗng.txt', data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(['bữa-ăn.csv', 'ngẫu-nhiên.bin', 'rỗng.txt']);
    expect(files.get('bữa-ăn.csv')!.equals(compressible)).toBe(true);
    expect(files.get('ngẫu-nhiên.bin')!.equals(incompressible)).toBe(true);
    expect(files.get('rỗng.txt')!.length).toBe(0);
    expect(zip.length).toBeLessThan(compressible.length); // thực sự được nén
  });
});

describe('CSV', () => {
  it('ô thường, số, boolean, null, ngày', () => {
    expect(csvCell('cơm')).toBe('cơm');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-0.5)).toBe('-0.5'); // số âm hợp lệ không bị thêm dấu
    expect(csvCell(true)).toBe('true');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-10-09T01:02:03Z'))).toBe('2026-10-09T01:02:03.000Z');
  });

  it('có dấu phẩy, nháy kép hoặc xuống dòng thì được bao trong nháy kép', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('nói "ngon"')).toBe('"nói ""ngon"""');
    expect(csvCell('dòng 1\ndòng 2')).toBe('"dòng 1\ndòng 2"');
  });

  it('chống CSV injection: chuỗi bắt đầu = + - @ không được thành công thức Excel', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('có BOM UTF-8, dòng kết thúc CRLF, hàng tiêu đề đúng', () => {
    const buf = toCsv([{ a: 'x', b: 1 }], [
      { header: 'cot_a', value: (r) => r.a },
      { header: 'cot_b', value: (r) => r.b },
    ]);
    expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(buf.toString('utf8')).toBe('﻿cot_a,cot_b\r\nx,1\r\n');
  });
});

// ---------------------------------------------------------------------------
// Dịch vụ xuất dữ liệu
// ---------------------------------------------------------------------------
const T0 = new Date('2026-10-09T03:00:00Z'); // 10:00 sáng 09/10 giờ Việt Nam

function makeDb(over: { failMealFind?: boolean } = {}) {
  const users = new Map<string, any>([
    [
      'u1',
      {
        id: 'u1', username: 'an', email: 'an@example.com', name: 'An', timezone: 'Asia/Ho_Chi_Minh', weightKg: 70,
        password: 'HASH', emailVerificationCode: '123456', emailVerificationExpiresAt: new Date(), passwordResetCode: '999',
        passwordResetExpiresAt: new Date(), refreshTokenHash: 'RT', googleId: 'g-1', lastExportAt: null,
      },
    ],
    ['u2', { id: 'u2', timezone: 'Asia/Ho_Chi_Minh', name: 'Bình', lastExportAt: null }],
    ['u3', { id: 'u3', timezone: 'Asia/Ho_Chi_Minh', name: 'Mới', lastExportAt: null }], // chưa có dữ liệu nào
  ]);
  const rows: Record<string, any[]> = {
    goal: [{ userId: 'u1', id: 'g1', goalType: 'LOSE_WEIGHT', startWeight: 80 }, { userId: 'u2', id: 'g2' }],
    targetChange: [{ userId: 'u1', id: 't1', source: 'ONBOARDING', oldCalories: null, newCalories: 1800, createdAt: new Date('2026-09-01') }],
    meal: [
      {
        userId: 'u1', id: 'm1', mealType: 'LUNCH', logDate: new Date('2026-10-08T00:00:00Z'),
        items: [
          { name: 'Cơm trắng', servingSize: '1 chén', quantity: 2, calories: 165, protein: 3.2, carb: 35, fat: 0.4, source: 'manual' },
          { name: '=CMD()', servingSize: null, quantity: 1, calories: 10, protein: 0, carb: 0, fat: 0, source: 'manual' },
        ],
      },
      { userId: 'u2', id: 'm2', mealType: 'DINNER', logDate: new Date('2026-10-08T00:00:00Z'), items: [{ name: 'MÓN NGƯỜI KHÁC', quantity: 1, calories: 999 }] },
    ],
    weightLog: [{ userId: 'u1', id: 'w1', date: new Date('2026-10-01'), weightKg: 71, note: 'sáng, trước ăn' }, { userId: 'u2', id: 'w2', date: new Date(), weightKg: 55 }],
    workoutLog: [
      {
        userId: 'u1', id: 'k1', name: 'Đẩy ngực', category: 'STRENGTH', date: new Date('2026-10-02'), durationMinutes: 45, caloriesBurned: 300, rpe: 8, note: null,
        exercises: [{ name: 'Bench', order: 0, sets: [{ setNumber: 1, reps: 8, weightKg: 60, rpe: 8 }, { setNumber: 2, reps: 6, weightKg: 62.5, rpe: 9 }] }],
      },
    ],
    checkIn: [{ userId: 'u1', id: 'c1' }],
    expenditureSnapshot: [{ userId: 'u1', id: 'e1', recordedAt: new Date('2026-10-03'), adaptiveExpenditure: 2400, staticTdee: 2300, status: 'UPDATING' }],
    waterLog: [{ userId: 'u1', id: 'wa1', loggedAt: new Date('2026-10-08'), amountMl: 250 }],
    customFood: [{ userId: 'u1', id: 'f1', name: 'Cơm nhà', servingSize: '1 bát', calories: 300, protein: 8, carb: 60, fat: 3, ingredients: null }],
    favoriteFood: [{ userId: 'u1', id: 'fv1', foodName: 'Phở bò' }],
    habitReminder: [{ userId: 'u1', id: 'h1', label: 'Bữa sáng', foods: [] }],
    dailyLogStatus: [{ userId: 'u1', logDate: new Date('2026-10-08'), completeness: 'COMPLETE' }],
    aiMessage: [{ userId: 'u1', id: 'a1', role: 'user', content: 'Ăn gì tối nay?' }],
    weeklySummary: [{ userId: 'u1', id: 's1', weekStartDate: new Date('2026-10-05') }],
    manualGrant: [{ userId: 'u1', adminId: 'ADMIN-SECRET', reason: 'x', startsAt: new Date('2026-10-01'), endsAt: new Date('2026-11-01'), revokedAt: null }],
    paymentOrder: [{ userId: 'u1', code: 'NWABCDEFGH', productId: 'premium_monthly', amount: 59000, status: 'PAID', createdAt: new Date('2026-10-01'), paidAt: new Date('2026-10-01'), approvedBy: 'AUTO:BANK' }],
  };
  const queried: Record<string, any[]> = {};
  const delegate = (name: string) => ({
    findMany: jest.fn(async ({ where }: any) => {
      (queried[name] ??= []).push(where);
      if (name === 'meal' && over.failMealFind) throw new Error('DB down');
      return (rows[name] ?? []).filter((r) => r.userId === where.userId);
    }),
  });
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (users.has(where.id) ? { ...users.get(where.id) } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) return { count: 0 };
        let ok = true;
        if (where.OR) {
          ok = where.OR.some((c: any) =>
            'lastExportAt' in c && c.lastExportAt === null
              ? u.lastExportAt === null
              : c.lastExportAt?.lt !== undefined
                ? u.lastExportAt !== null && u.lastExportAt < c.lastExportAt.lt
                : false,
          );
        } else if (where.lastExportAt !== undefined) {
          ok = u.lastExportAt?.getTime() === where.lastExportAt?.getTime();
        }
        if (!ok) return { count: 0 };
        Object.assign(u, data);
        return { count: 1 };
      }),
    },
    subscriptionState: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.userId === 'u1' ? { userId: 'u1', productId: 'premium_monthly', status: 'ACTIVE', expiryTime: new Date('2026-11-01'), autoRenewing: true, isTrial: false, currentPurchaseToken: 'SECRET-TOKEN' } : null,
      ),
    },
  };
  for (const name of Object.keys(rows)) prisma[name] = delegate(name);
  prisma.user.findUnique.mockImplementation(async ({ where }: any) => (users.has(where.id) ? { ...users.get(where.id) } : null));
  return { prisma, users, queried };
}

describe('Xuất dữ liệu (BR-18)', () => {
  it('gói ZIP chứa đủ các file JSON, CSV, manifest và README', async () => {
    const { prisma } = makeDb();
    const res = await new DataExportService(prisma).exportUserData('u1', T0);
    const files = readZip(res.buffer);
    for (const name of [
      'profile.json', 'goals.json', 'target-changes.json', 'meals.json', 'meals.csv', 'weight-logs.json', 'weight-logs.csv',
      'workouts.json', 'workouts.csv', 'workout-sets.csv', 'check-ins.json', 'expenditure-snapshots.json', 'expenditure-snapshots.csv',
      'water-logs.json', 'water-logs.csv', 'custom-foods.json', 'custom-foods.csv', 'favorite-foods.json', 'habit-reminders.json',
      'daily-log-status.json', 'ai-chat-messages.json', 'weekly-summaries.json', 'subscription.json', 'target-changes.csv',
      'manifest.json', 'README.txt',
    ]) {
      expect(files.has(name)).toBe(true);
    }
    expect(res.filename).toBe('nutriwise-export-2026-10-09.zip');
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest).toMatchObject({ app: 'NutriWise', userId: 'u1', exportDate: '2026-10-09', formatVersion: 1 });
    expect(manifest.files['meals.json']).toBe(1);
    expect(manifest.files['meals.csv']).toBe(2); // 2 món
  });

  it('hồ sơ KHÔNG chứa mật khẩu, mã xác thực, mã đặt lại, refresh token hay googleId; vẫn có dữ liệu hợp lệ', async () => {
    const { prisma } = makeDb();
    const files = readZip((await new DataExportService(prisma).exportUserData('u1', T0)).buffer);
    const profileText = files.get('profile.json')!.toString();
    const profile = JSON.parse(profileText);
    for (const field of PROFILE_EXCLUDED_FIELDS) expect(profile).not.toHaveProperty(field);
    for (const secret of ['HASH', '123456', 'RT', 'g-1']) expect(profileText).not.toContain(secret);
    expect(profile).toMatchObject({ name: 'An', email: 'an@example.com', weightKg: 70 });
  });

  it('thông tin gói không lộ mã giao dịch hay định danh quản trị viên', async () => {
    const { prisma } = makeDb();
    const files = readZip((await new DataExportService(prisma).exportUserData('u1', T0)).buffer);
    const text = files.get('subscription.json')!.toString();
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('ADMIN-SECRET');
    expect(text).not.toContain('AUTO:BANK');
    const sub = JSON.parse(text);
    expect(sub.subscription).toMatchObject({ productId: 'premium_monthly', status: 'ACTIVE' });
    expect(sub.paymentOrders[0]).toMatchObject({ code: 'NWABCDEFGH', amount: 59000, status: 'PAID' });
  });

  it('CÔ LẬP DỮ LIỆU: mọi truy vấn đều lọc theo userId và không lọt dữ liệu của người khác', async () => {
    const { prisma, queried } = makeDb();
    const res = await new DataExportService(prisma).exportUserData('u1', T0);
    for (const [table, wheres] of Object.entries(queried)) {
      for (const where of wheres) expect(where).toMatchObject({ userId: 'u1' });
      expect(wheres.length).toBeGreaterThan(0);
      void table;
    }
    const all = [...readZip(res.buffer).values()].map((b) => b.toString()).join('\n');
    expect(all).not.toContain('MÓN NGƯỜI KHÁC');
    expect(all).not.toContain('"g2"');
    expect(all).not.toContain('Bình');
  });

  it('meals.csv: một dòng mỗi món, calo tổng = calo/phần × số phần, chống công thức, mở được tiếng Việt', async () => {
    const { prisma } = makeDb();
    const files = readZip((await new DataExportService(prisma).exportUserData('u1', T0)).buffer);
    const csv = files.get('meals.csv')!.toString('utf8');
    expect(csv.startsWith('﻿ngay,bua_an,ten_mon')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('2026-10-08,LUNCH,Cơm trắng,1 chén,2,165,3.2,35,0.4,330,manual');
    expect(lines[2]).toContain("'=CMD()");
  });

  it('workouts.csv và workout-sets.csv; ghi chú có dấu phẩy được bao nháy kép', async () => {
    const { prisma } = makeDb();
    const files = readZip((await new DataExportService(prisma).exportUserData('u1', T0)).buffer);
    expect(files.get('workout-sets.csv')!.toString().trim().split('\r\n')).toHaveLength(3);
    expect(files.get('weight-logs.csv')!.toString()).toContain('"sáng, trước ăn"');
  });

  it('người dùng chưa có dữ liệu nào vẫn xuất được gói hợp lệ (các file rỗng, không lỗi)', async () => {
    const { prisma } = makeDb();
    const res = await new DataExportService(prisma).exportUserData('u3', T0);
    const files = readZip(res.buffer);
    expect(JSON.parse(files.get('meals.json')!.toString())).toEqual([]);
    // trim() của JS cũng cắt BOM nên so sánh phần tiêu đề không kèm BOM
    expect(files.get('meals.csv')!.toString().trim()).toBe('ngay,bua_an,ten_mon,khau_phan,so_phan,calo_tren_1_phan,dam_g_tren_1_phan,tinh_bot_g_tren_1_phan,beo_g_tren_1_phan,calo_tong,nguon');
    expect(JSON.parse(files.get('subscription.json')!.toString()).subscription).toBeNull();
  });
});

describe('Xuất dữ liệu: tối đa 1 lần mỗi ngày', () => {
  it('lần thứ hai trong cùng ngày bị chặn bằng QUOTA_EXCEEDED, không mời nâng cấp', async () => {
    const { prisma } = makeDb();
    const svc = new DataExportService(prisma);
    await svc.exportUserData('u1', T0);
    const err: any = await svc.exportUserData('u1', new Date(T0.getTime() + 3600_000)).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'QUOTA_EXCEEDED', feature: 'DATA_EXPORT', limit: 1, used: 1, period: 'day', upgrade: false });
    expect(new Date(err.getResponse().resetsAt).toISOString()).toBe('2026-10-09T17:00:00.000Z'); // 00:00 ngày 10/10 giờ VN
  });

  it('sang ngày mới theo múi giờ của người dùng thì xuất lại được (23:30 → 00:30 giờ VN)', async () => {
    const { prisma } = makeDb();
    const svc = new DataExportService(prisma);
    await svc.exportUserData('u1', new Date('2026-10-09T16:30:00Z')); // 23:30 ngày 09 giờ VN
    await expect(svc.exportUserData('u1', new Date('2026-10-09T17:30:00Z'))).resolves.toBeDefined(); // 00:30 ngày 10
  });

  it('hai yêu cầu đồng thời: đúng một yêu cầu xuất được', async () => {
    const { prisma } = makeDb();
    const svc = new DataExportService(prisma);
    const results = await Promise.allSettled([svc.exportUserData('u1', T0), svc.exportUserData('u1', T0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('gom dữ liệu thất bại thì trả lại lượt: thử lại được ngay, không bị mất lượt trong ngày', async () => {
    const failing = makeDb({ failMealFind: true });
    const svc = new DataExportService(failing.prisma);
    await expect(svc.exportUserData('u1', T0)).rejects.toThrow('DB down');
    expect(failing.users.get('u1').lastExportAt).toBeNull();

    const ok = makeDb();
    ok.users.get('u1').lastExportAt = null;
    await expect(new DataExportService(ok.prisma).exportUserData('u1', T0)).resolves.toBeDefined();
  });

  it('lượt xuất của người này không ảnh hưởng người kia', async () => {
    const { prisma } = makeDb();
    const svc = new DataExportService(prisma);
    await svc.exportUserData('u1', T0);
    await expect(svc.exportUserData('u2', T0)).resolves.toBeDefined();
  });
});

describe('Endpoint me/export', () => {
  it('trả file ZIP kèm header tải về, không bọc JSON', async () => {
    const buffer = createZip([{ name: 'a.txt', data: Buffer.from('xin chào') }]);
    const exporter: any = { exportUserData: jest.fn(async () => ({ buffer, filename: 'nutriwise-export-2026-10-09.zip', files: ['a.txt'] })) };
    const controller = new DataExportController(exporter);
    const headers: Record<string, string> = {};
    const res: any = { set: (h: Record<string, string>) => Object.assign(headers, h) };
    const out = await controller.export('u1', res);
    expect(out).toBeInstanceOf(StreamableFile);
    expect(headers['Content-Type']).toBe('application/zip');
    expect(headers['Content-Disposition']).toBe('attachment; filename="nutriwise-export-2026-10-09.zip"');
    expect(headers['Content-Length']).toBe(String(buffer.length));
    expect(headers['Cache-Control']).toBe('no-store');
    expect(exporter.exportUserData).toHaveBeenCalledWith('u1');
  });

  it('TransformInterceptor không bọc StreamableFile và Buffer (file tải về giữ nguyên)', async () => {
    const interceptor = new TransformInterceptor();
    const ctx: any = { switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }) };
    const file = new StreamableFile(Buffer.from('zip'));
    expect(await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(file) }))).toBe(file);
    const buf = Buffer.from('zip');
    expect(await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(buf) }))).toBe(buf);
  });

  it('phản hồi JSON thường vẫn được bọc như cũ', async () => {
    const interceptor = new TransformInterceptor();
    const ctx: any = { switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }) };
    const out: any = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({ message: 'ok', data: { x: 1 } }) }));
    expect(out).toMatchObject({ success: true, statusCode: 200, message: 'ok', data: { x: 1 } });
  });
});
