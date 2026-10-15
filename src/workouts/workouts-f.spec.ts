import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { WorkoutsInsightsService } from './workouts-insights.service';
import { WorkoutRoutinesService, MAX_ROUTINES_PER_USER } from './workout-routines.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { CreateCustomExerciseDto, CreateRoutineDto } from './dto/workout-routine.dto';
import {
  SetForRecords,
  computeRecords,
  epley1rm,
  exerciseKey,
  newRecordsOf,
  sessionVolume,
  setVolume,
} from './workout-records';
import { activityBucket, mondayKeyOf, validateSession, weightJumpWarnings } from './workout-rules';

const day = (iso: string) => new Date(iso + 'T00:00:00Z');
const set = (id: string, weightKg: number, reps: number, over: Partial<SetForRecords> = {}): SetForRecords => ({
  setId: id, workoutId: 'w1', weightKg, reps, isWarmup: false, achievedAt: day('2026-10-01'), ...over,
});

describe('Kỷ lục cá nhân (BR-10.8)', () => {
  it('khoá bài: theo mã khi có, theo tên không dấu khi chỉ có tên', () => {
    expect(exerciseKey({ exerciseSource: 'CATALOG', exerciseRefId: 'm-beg-01', name: 'x' })).toBe('CATALOG:m-beg-01');
    expect(exerciseKey({ exerciseSource: null, exerciseRefId: null, name: 'Đẩy Ngực  Ngang' })).toBe('name:day nguc ngang');
    expect(exerciseKey({ name: 'Bench Press' })).toBe('name:bench press');
  });

  it('Epley: weight × (1 + reps/30)', () => {
    expect(epley1rm(100, 10)).toBeCloseTo(133.33, 2);
    expect(epley1rm(60, 1)).toBeCloseTo(62, 2);
  });

  it('tạ cao nhất, số lần cao nhất ở từng mức tạ, 1RM ước tính', () => {
    const r = computeRecords([set('a', 60, 10), set('b', 80, 5), set('c', 80, 6), set('d', 100, 1)]);
    const get = (type: string, wk = 0) => r.find((x) => x.type === type && x.weightKey === wk);
    expect(get('MAX_WEIGHT')).toMatchObject({ value: 100, setId: 'd' });
    expect(get('MAX_REPS_AT_WEIGHT', 80)).toMatchObject({ value: 6, setId: 'c' });
    expect(get('MAX_REPS_AT_WEIGHT', 60)?.value).toBe(10);
    expect(get('EST_1RM')).toMatchObject({ setId: 'd' }); // 100×1 → 103,33 lớn hơn 80×6 → 96
  });

  it('1RM ước tính chọn đúng giá trị lớn nhất', () => {
    const r = computeRecords([set('a', 60, 10), set('b', 100, 1)]);
    // 60×(1+10/30) = 80; 100×(1+1/30) = 103,33
    expect(r.find((x) => x.type === 'EST_1RM')).toMatchObject({ setId: 'b' });
  });

  it('set khởi động không bao giờ tính vào kỷ lục', () => {
    const r = computeRecords([set('w', 200, 5, { isWarmup: true }), set('a', 50, 5)]);
    expect(r.find((x) => x.type === 'MAX_WEIGHT')?.value).toBe(50);
    expect(computeRecords([set('w', 200, 5, { isWarmup: true })])).toEqual([]);
  });

  it('1RM chỉ tính với set không quá 12 lần', () => {
    const r = computeRecords([set('a', 40, 20)]);
    expect(r.find((x) => x.type === 'EST_1RM')).toBeUndefined();
    expect(r.find((x) => x.type === 'MAX_WEIGHT')?.value).toBe(40);
    expect(computeRecords([set('a', 40, 12)]).some((x) => x.type === 'EST_1RM')).toBe(true);
  });

  it('bài tạ cơ thể: số lần cao nhất, không có kỷ lục tạ', () => {
    const r = computeRecords([set('a', 0, 15), set('b', 0, 22), set('c', 0, 18)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'MAX_REPS_BODYWEIGHT', value: 22, setId: 'b', weightKg: null });
  });

  it('hoà giá trị: giữ set đạt sớm nhất', () => {
    const r = computeRecords([set('late', 80, 5, { achievedAt: day('2026-10-09') }), set('early', 80, 5, { achievedAt: day('2026-10-02') })]);
    expect(r.find((x) => x.type === 'MAX_WEIGHT')?.setId).toBe('early');
  });

  it('kỷ lục mới: phá kỷ lục cũ thì báo; bằng hoặc thấp hơn thì không', () => {
    const before = computeRecords([set('a', 80, 5)]);
    expect(newRecordsOf(before, computeRecords([set('a', 80, 5), set('b', 85, 3)])).map((r) => r.type)).toContain('MAX_WEIGHT');
    expect(newRecordsOf(before, computeRecords([set('a', 80, 5), set('c', 70, 5)])).some((r) => r.type === 'MAX_WEIGHT')).toBe(false);
    expect(newRecordsOf(before, before)).toEqual([]);
  });

  it('bài lần đầu tập chỉ báo mốc đầu tiên, không báo cả bộ kỷ lục; mức tạ mới không phải kỷ lục', () => {
    const first = newRecordsOf([], computeRecords([set('a', 60, 8)]));
    expect(first.map((r) => r.type)).toEqual(['MAX_WEIGHT']);
    const before = computeRecords([set('a', 60, 8)]);
    const after = computeRecords([set('a', 60, 8), set('b', 40, 12)]);
    expect(newRecordsOf(before, after).some((r) => r.type === 'MAX_REPS_AT_WEIGHT')).toBe(false);
  });

  it('volume: bài tạ cơ thể tính theo số lần; buổi tập bỏ set khởi động', () => {
    expect(setVolume(60, 10)).toBe(600);
    expect(setVolume(0, 15)).toBe(15);
    expect(sessionVolume([{ sets: [{ weightKg: 60, reps: 10 }, { weightKg: 100, reps: 5, isWarmup: true }, { weightKg: 0, reps: 12 }] }])).toBe(612);
  });
});

describe('Quy tắc buổi tập (BR-10.4)', () => {
  it('buổi tập tạ phải có bài và có set không khởi động', () => {
    expect(validateSession({ category: 'STRENGTH', durationMinutes: 45 })).toHaveLength(1);
    expect(validateSession({ category: 'STRENGTH', durationMinutes: 45, exercises: [] })).toHaveLength(1);
    expect(validateSession({ category: 'STRENGTH', durationMinutes: 45, exercises: [{ name: 'a', sets: [{ reps: 5, weightKg: 20, isWarmup: true }] }] })[0]).toMatch(/không phải khởi động/);
    expect(validateSession({ category: 'STRENGTH', durationMinutes: 45, exercises: [{ name: 'a', sets: [{ reps: 5, weightKg: 20 }] }] })).toEqual([]);
  });

  it('cardio chỉ cần thời lượng hợp lệ', () => {
    expect(validateSession({ category: 'RUNNING', durationMinutes: 30 })).toEqual([]);
    expect(validateSession({ category: 'RUNNING', durationMinutes: 0 })).toHaveLength(1);
    expect(validateSession({ category: 'RUNNING', durationMinutes: 601 })).toHaveLength(1);
  });

  it('cảnh báo mềm khi tạ gấp hơn 2 lần lần trước', () => {
    const prev = new Map([['name:squat', 60]]);
    expect(weightJumpWarnings([{ key: 'name:squat', name: 'Squat', maxWeightKg: 130 }], prev)).toEqual([{ name: 'Squat', previousKg: 60, currentKg: 130 }]);
    expect(weightJumpWarnings([{ key: 'name:squat', name: 'Squat', maxWeightKg: 120 }], prev)).toEqual([]); // đúng 2 lần thì chưa cảnh báo
    expect(weightJumpWarnings([{ key: 'name:moi', name: 'Mới', maxWeightKg: 500 }], prev)).toEqual([]); // bài chưa có lịch sử
  });

  it('tuần bắt đầu Thứ Hai; nhóm hệ số vận động 0 / 1–2 / 3–4 / 5–6 / 7', () => {
    expect(mondayKeyOf('2026-10-14')).toBe('2026-10-12');
    expect(mondayKeyOf('2026-10-18')).toBe('2026-10-12'); // Chủ Nhật
    expect(mondayKeyOf('2026-10-12')).toBe('2026-10-12');
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(activityBucket)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('DTO ghi buổi tập', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (v: any) => pipe.transform(v, { type: 'body', metatype: CreateWorkoutLogDto });
  const ok = {
    name: 'Ngực', category: 'STRENGTH', durationMinutes: 50,
    exercises: [{ name: 'Bench', sets: [{ setNumber: 1, reps: 10, weightKg: 60, rpe: 8.5 }] }],
  };
  const withSet = (patch: any) => ({ ...ok, exercises: [{ name: 'Bench', sets: [{ setNumber: 1, reps: 10, weightKg: 60, ...patch }] }] });

  it('hợp lệ, kể cả khởi động, RPE bước 0,5, thời gian và quãng đường', async () => {
    await expect(validate(ok)).resolves.toBeDefined();
    await expect(validate(withSet({ isWarmup: true, rpe: 7.5, durationSec: 40, distanceM: 100 }))).resolves.toBeDefined();
    await expect(validate({ ...ok, clientRequestId: 'abc-123', startedAt: '2026-10-12T01:00:00Z' })).resolves.toBeDefined();
  });

  it.each([
    ['reps > 100', withSet({ reps: 101 })],
    ['tạ > 500 kg', withSet({ weightKg: 501 })],
    ['tạ âm', withSet({ weightKg: -1 })],
    ['RPE 7,3 (không theo bước 0,5)', withSet({ rpe: 7.3 })],
    ['RPE 0,5', withSet({ rpe: 0.5 })],
    ['RPE 10,5', withSet({ rpe: 10.5 })],
    ['thời lượng 601 phút', { ...ok, durationMinutes: 601 }],
    ['thời lượng 0', { ...ok, durationMinutes: 0 }],
    ['nguồn bài sai', { ...ok, exercises: [{ name: 'a', exerciseSource: 'KHAC', sets: [{ setNumber: 1, reps: 5, weightKg: 1 }] }] }],
    ['nghỉ quá 900 giây', { ...ok, exercises: [{ name: 'a', restSec: 901, sets: [{ setNumber: 1, reps: 5, weightKg: 1 }] }] }],
  ])('từ chối: %s', async (_n, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** Cơ sở dữ liệu giả trong bộ nhớ đủ cho luồng ghi/sửa/xoá buổi tập và kỷ lục. */
function fakeDb(opts: { weight?: number; tz?: string } = {}) {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const workouts: any[] = [];
  const records: any[] = [];
  const db: any = {};
  const withIncludes = (w: any) => ({
    ...w,
    exercises: w.exercises.map((e: any) => ({ ...e, sets: [...e.sets].sort((a: any, b: any) => a.setNumber - b.setNumber) })),
  });
  db.user = {
    findUnique: jest.fn(async () => ({ weightKg: opts.weight ?? 70, timezone: opts.tz ?? 'Asia/Ho_Chi_Minh' })),
  };
  db.workoutLog = {
    findFirst: jest.fn(async ({ where }: any) => {
      const w = workouts.find((x) => x.userId === where.userId && (where.id ? x.id === where.id : x.clientRequestId === where.clientRequestId));
      return w ? withIncludes(w) : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (data.clientRequestId && workouts.some((x) => x.userId === data.userId && x.clientRequestId === data.clientRequestId)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const wid = id('w');
      const w = {
        id: wid, ...data, exercises: [],
      };
      w.exercises = (data.exercises?.create ?? []).map((e: any) => {
        const eid = id('e');
        return { id: eid, workoutLogId: wid, ...e, sets: e.sets.create.map((s: any) => ({ id: id('s'), exerciseId: eid, ...s })) };
      });
      workouts.push(w);
      return withIncludes(w);
    }),
    delete: jest.fn(async ({ where }: any) => {
      workouts.splice(workouts.findIndex((x) => x.id === where.id), 1);
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const w = workouts.find((x) => x.id === where.id);
      Object.assign(w, Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && k !== 'exercises')));
      if (data.exercises?.create) {
        w.exercises = data.exercises.create.map((e: any) => {
          const eid = id('e');
          return { id: eid, workoutLogId: w.id, ...e, sets: e.sets.create.map((s: any) => ({ id: id('s'), exerciseId: eid, ...s })) };
        });
      }
      return withIncludes(w);
    }),
  };
  db.workoutExercise = {
    findMany: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
    deleteMany: jest.fn(async ({ where }: any) => {
      const w = workouts.find((x) => x.id === where.workoutLogId);
      if (w) w.exercises = [];
    }),
  };
  db.workoutSet = {
    findMany: jest.fn(async ({ where }: any) => {
      const out: any[] = [];
      for (const w of workouts) {
        if (w.userId !== where.exercise.workoutLog.userId) continue;
        for (const e of w.exercises) {
          if (e.exerciseKey !== where.exercise.exerciseKey) continue;
          for (const s of e.sets) out.push({ id: s.id, reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup ?? false, exercise: { workoutLogId: w.id, workoutLog: { date: w.date } } });
        }
      }
      return out;
    }),
  };
  db.personalRecord = {
    findMany: jest.fn(async ({ where }: any) => records.filter((r) => r.userId === where.userId && where.exerciseKey.in.includes(r.exerciseKey))),
    deleteMany: jest.fn(async ({ where }: any) => {
      for (let i = records.length - 1; i >= 0; i--) if (records[i].userId === where.userId && records[i].exerciseKey === where.exerciseKey) records.splice(i, 1);
    }),
    createMany: jest.fn(async ({ data }: any) => records.push(...data)),
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return { db, workouts, records };
}

const strength = (over: any = {}) => ({
  name: 'Ngực', category: 'STRENGTH', durationMinutes: 50, date: '2026-10-10',
  exercises: [{ name: 'Bench Press', sets: [{ setNumber: 1, reps: 8, weightKg: 60 }, { setNumber: 2, reps: 6, weightKg: 70 }] }],
  ...over,
});

describe('Ghi buổi tập (F2)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-12T03:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
  });
  afterAll(() => jest.useRealTimers());

  it('AC1: gửi lại cùng clientRequestId 3 lần chỉ có đúng 1 buổi', async () => {
    const { db, workouts } = fakeDb();
    const svc = new WorkoutsService(db);
    const body = strength({ clientRequestId: 'req-1' }) as any;
    const a: any = await svc.createWorkout('u1', body);
    const b: any = await svc.createWorkout('u1', body);
    const c: any = await svc.createWorkout('u1', body);
    expect(workouts).toHaveLength(1);
    expect(b.id).toBe(a.id);
    expect(c.deduplicated).toBe(true);
    expect(a.deduplicated).toBeUndefined();
  });

  it('hai request đồng thời cùng clientRequestId: người thua trả buổi của người thắng', async () => {
    const { db, workouts } = fakeDb();
    const svc = new WorkoutsService(db);
    const body = strength({ clientRequestId: 'req-2' }) as any;
    const [x, y]: any[] = await Promise.all([svc.createWorkout('u1', body), svc.createWorkout('u1', body)]);
    expect(workouts).toHaveLength(1);
    expect(x.id).toBe(y.id);
  });

  it('cùng clientRequestId của người dùng khác không bị coi là trùng', async () => {
    const { db, workouts } = fakeDb();
    const svc = new WorkoutsService(db);
    await svc.createWorkout('u1', strength({ clientRequestId: 'same' }) as any);
    await svc.createWorkout('u2', strength({ clientRequestId: 'same' }) as any);
    expect(workouts).toHaveLength(2);
  });

  it('không cho ngày tương lai theo múi giờ người dùng; hôm nay và quá khứ thì được', async () => {
    const { db } = fakeDb();
    const svc = new WorkoutsService(db);
    await expect(svc.createWorkout('u1', strength({ date: '2026-10-13' }) as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createWorkout('u1', strength({ date: '2026-10-12' }) as any)).resolves.toBeDefined();
    await expect(svc.createWorkout('u1', strength({ date: '2026-01-01' }) as any)).resolves.toBeDefined();
  });

  it('múi giờ: bây giờ là ngày 12 ở Việt Nam nhưng vẫn là ngày 11 ở Los Angeles', async () => {
    const vn = new WorkoutsService(fakeDb().db);
    // Bây giờ là 10:00 giờ Việt Nam ngày 12/10
    await expect(vn.createWorkout('u1', strength({ date: '2026-10-12' }) as any)).resolves.toBeDefined();
    const la = new WorkoutsService(fakeDb({ tz: 'America/Los_Angeles' }).db);
    await expect(la.createWorkout('u1', strength({ date: '2026-10-11' }) as any)).resolves.toBeDefined();
    await expect(la.createWorkout('u1', strength({ date: '2026-10-12' }) as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('buổi tập tạ không có set tập thật thì không lưu', async () => {
    const { db, workouts } = fakeDb();
    const svc = new WorkoutsService(db);
    await expect(svc.createWorkout('u1', strength({ exercises: [] }) as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.createWorkout('u1', strength({ exercises: [{ name: 'a', sets: [{ setNumber: 1, reps: 5, weightKg: 20, isWarmup: true }] }] }) as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workouts).toHaveLength(0);
  });

  it('endedAt trước startedAt bị từ chối', async () => {
    const svc = new WorkoutsService(fakeDb().db);
    await expect(svc.createWorkout('u1', strength({ startedAt: '2026-10-10T10:00:00Z', endedAt: '2026-10-10T09:00:00Z' }) as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calo = (MET − 1) × cân nặng × giờ; MET lạ dùng 4,0; volume bỏ set khởi động', async () => {
    const svc = new WorkoutsService(fakeDb({ weight: 70 }).db);
    expect(svc.calculateCalories('RUNNING' as any, 60, 70)).toBeCloseTo((9.8 - 1) * 70, 1);
    expect(svc.calculateCalories('KHONG_CO' as any, 60, 70)).toBeCloseTo((4 - 1) * 70, 1);
    const res: any = await svc.createWorkout('u1', strength({
      exercises: [{ name: 'Bench', sets: [{ setNumber: 1, reps: 5, weightKg: 100, isWarmup: true }, { setNumber: 2, reps: 10, weightKg: 60 }] }],
    }) as any);
    expect(res.totalVolumeKg).toBe(600);
    expect(res.caloriesBurned).toBeCloseTo((5 - 1) * 70 * (50 / 60), 1);
  });

  it('trả kỷ lục mới ở tóm tắt buổi tập và cảnh báo mềm khi tạ nhảy gấp đôi', async () => {
    const { db } = fakeDb();
    const svc = new WorkoutsService(db);
    const first: any = await svc.createWorkout('u1', strength() as any);
    expect(first.newRecords.map((r: any) => r.type)).toEqual(['MAX_WEIGHT']);
    expect(first.warnings).toEqual([]);

    const second: any = await svc.createWorkout('u1', strength({
      date: '2026-10-11',
      exercises: [{ name: 'Bench Press', sets: [{ setNumber: 1, reps: 1, weightKg: 150 }] }],
    }) as any);
    expect(second.newRecords.some((r: any) => r.type === 'MAX_WEIGHT' && r.value === 150)).toBe(true);
    expect(second.warnings).toEqual([{ name: 'Bench Press', previousKg: 70, currentKg: 150 }]);
  });

  it('AC3: xoá buổi đang giữ kỷ lục thì kỷ lục lùi về giá trị kế tiếp', async () => {
    const { db, records } = fakeDb();
    const svc = new WorkoutsService(db);
    await svc.createWorkout('u1', strength({ date: '2026-10-01', exercises: [{ name: 'Bench Press', sets: [{ setNumber: 1, reps: 5, weightKg: 80 }] }] }) as any);
    const big: any = await svc.createWorkout('u1', strength({ date: '2026-10-05', exercises: [{ name: 'Bench Press', sets: [{ setNumber: 1, reps: 3, weightKg: 100 }] }] }) as any);
    const top = () => records.find((r) => r.type === 'MAX_WEIGHT')?.value;
    expect(top()).toBe(100);
    await svc.deleteWorkout('u1', big.id);
    expect(top()).toBe(80);
  });

  it('xoá buổi cuối cùng của bài thì hết kỷ lục của bài đó', async () => {
    const { db, records } = fakeDb();
    const svc = new WorkoutsService(db);
    const w: any = await svc.createWorkout('u1', strength() as any);
    expect(records.length).toBeGreaterThan(0);
    await svc.deleteWorkout('u1', w.id);
    expect(records).toHaveLength(0);
  });

  it('sửa buổi (thay danh sách bài/set) tính lại kỷ lục; set khởi động không tính', async () => {
    const { db, records } = fakeDb();
    const svc = new WorkoutsService(db);
    const w: any = await svc.createWorkout('u1', strength() as any);
    expect(records.find((r) => r.type === 'MAX_WEIGHT')?.value).toBe(70);
    await svc.updateWorkout('u1', w.id, {
      exercises: [{ name: 'Bench Press', sets: [{ setNumber: 1, reps: 5, weightKg: 200, isWarmup: true }, { setNumber: 2, reps: 5, weightKg: 65 }] }],
    } as any);
    expect(records.find((r) => r.type === 'MAX_WEIGHT')?.value).toBe(65);
  });

  it('sửa buổi sang ngày tương lai bị từ chối; sửa buổi không tồn tại → 404', async () => {
    const { db } = fakeDb();
    const svc = new WorkoutsService(db);
    const w: any = await svc.createWorkout('u1', strength() as any);
    await expect(svc.updateWorkout('u1', w.id, { date: '2026-12-01' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateWorkout('u1', 'khong-co', { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa làm buổi tạ hết set tập thật thì bị từ chối', async () => {
    const { db } = fakeDb();
    const svc = new WorkoutsService(db);
    const w: any = await svc.createWorkout('u1', strength() as any);
    await expect(svc.updateWorkout('u1', w.id, { exercises: [] } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lỗi khi tính kỷ lục không làm hỏng việc ghi buổi tập', async () => {
    const { db, workouts } = fakeDb();
    db.personalRecord.createMany = jest.fn(async () => {
      throw new Error('db down');
    });
    const svc = new WorkoutsService(db);
    const res: any = await svc.createWorkout('u1', strength() as any);
    expect(res.id).toBeDefined();
    expect(workouts).toHaveLength(1);
    expect(res.newRecords).toEqual([]);
  });

  it('AC2: ghi buổi tập không đụng tới mục tiêu dinh dưỡng của người dùng', async () => {
    const { db } = fakeDb();
    db.user.update = jest.fn();
    db.targetChange = { create: jest.fn() };
    await new WorkoutsService(db).createWorkout('u1', strength() as any);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.targetChange.create).not.toHaveBeenCalled();
  });
});

describe('Đối chiếu số buổi tập thực tế (F4)', () => {
  const NOW = new Date('2026-10-14T03:00:00Z'); // Thứ Tư; tuần hiện tại bắt đầu 12/10; cửa sổ 14/09 – 11/10
  const build = (user: any, sessionDays: string[]) => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({
          trainingDaysPerWeek: 2, programType: 'COACHED', createdAt: new Date('2026-01-01T00:00:00Z'),
          timezone: 'Asia/Ho_Chi_Minh', expenditureStatus: 'LEARNING', activityCheckAt: null, ...user,
        })),
        update: jest.fn(async () => ({})),
      },
      workoutLog: { findMany: jest.fn(async () => sessionDays.map((d) => ({ date: day(d) }))) },
    };
    return { svc: new WorkoutsInsightsService(prisma), prisma };
  };
  // 4 tuần liền, mỗi tuần 4 buổi
  const fourPerWeek = ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-24', '2026-09-26',
    '2026-09-28', '2026-09-29', '2026-10-01', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-08', '2026-10-10'];

  it('AC4: khai báo 1–2 buổi/tuần nhưng 4 tuần liền tập 4 buổi → đề xuất cập nhật', async () => {
    const { svc } = build({}, fourPerWeek);
    const r: any = await svc.activityCheck('u1', NOW);
    expect(r).toMatchObject({ eligible: true, mismatch: true, declaredDays: 2, averagePerWeek: 4, suggestedTrainingDays: 4, weeklyCounts: [4, 4, 4, 4] });
    expect(r.message).toMatch(/4 buổi\/tuần/);
  });

  it('không lệch nhóm thì không đề xuất', async () => {
    const { svc } = build({ trainingDaysPerWeek: 4 }, fourPerWeek);
    expect(await svc.activityCheck('u1', NOW)).toMatchObject({ eligible: true, mismatch: false });
  });

  it('chỉ lệch 2/4 tuần thì chưa đủ ngưỡng 3/4', async () => {
    const days = ['2026-09-14', '2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    // tuần 1: 2, tuần 2: 2, tuần 3: 4, tuần 4: 4 với khai báo 2 → lệch 2/4
    const { svc } = build({}, days);
    expect(await svc.activityCheck('u1', NOW)).toMatchObject({ mismatch: false, weeklyCounts: [2, 2, 4, 4] });
  });

  it('lệch về phía ít hơn: khai báo 5 buổi nhưng tập 1 buổi/tuần', async () => {
    const { svc } = build({ trainingDaysPerWeek: 5 }, ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06']);
    expect(await svc.activityCheck('u1', NOW)).toMatchObject({ mismatch: true, suggestedTrainingDays: 1 });
  });

  it('tài khoản chưa đủ 4 tuần lịch sử thì chưa đối chiếu', async () => {
    const { svc } = build({ createdAt: new Date('2026-10-01T00:00:00Z') }, fourPerWeek);
    expect(await svc.activityCheck('u1', NOW)).toEqual({ eligible: false, reason: 'NOT_ENOUGH_HISTORY' });
  });

  it('chưa khai báo số buổi thì không đối chiếu', async () => {
    const { svc } = build({ trainingDaysPerWeek: null }, fourPerWeek);
    expect(await svc.activityCheck('u1', NOW)).toEqual({ eligible: false, reason: 'NO_DECLARED_DAYS' });
  });

  it('người tự quản được hỏi mỗi 28 ngày; người có huấn luyện mỗi 7 ngày', async () => {
    const handled = new Date('2026-10-01T00:00:00Z'); // 13 ngày trước
    expect(await build({ programType: 'MANUAL', activityCheckAt: handled }, fourPerWeek).svc.activityCheck('u1', NOW)).toEqual({ eligible: false, reason: 'RECENTLY_HANDLED' });
    expect((await build({ programType: 'COACHED', activityCheckAt: handled }, fourPerWeek).svc.activityCheck('u1', NOW) as any).eligible).toBe(true);
  });

  it('khi engine ổn định thêm ghi chú; không tự đổi hồ sơ; đánh dấu đã xử lý ghi thời điểm', async () => {
    const { svc, prisma } = build({ expenditureStatus: 'STABLE' }, fourPerWeek);
    const r: any = await svc.activityCheck('u1', NOW);
    expect(r.note).toMatch(/đã được điều chỉnh theo dữ liệu thật/);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await svc.markActivityCheckHandled('u1', NOW);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { activityCheckAt: NOW } });
  });
});

describe('Lịch sử, thống kê, mẫu buổi tập (F3, F5)', () => {
  it('lịch tháng: gom theo ngày và kiểm tra định dạng tháng', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      workoutLog: {
        findMany: jest.fn(async () => [
          { id: 'a', name: 'Ngực', category: 'STRENGTH', date: day('2026-10-03'), durationMinutes: 50, caloriesBurned: 200, exercises: [{ sets: [{ isWarmup: true }, { isWarmup: false }] }] },
          { id: 'b', name: 'Chạy', category: 'RUNNING', date: day('2026-10-03'), durationMinutes: 30, caloriesBurned: 300, exercises: [] },
          { id: 'c', name: 'Chân', category: 'STRENGTH', date: day('2026-10-07'), durationMinutes: 60, caloriesBurned: 250, exercises: [] },
        ]),
      },
    };
    const svc = new WorkoutsInsightsService(prisma);
    const r = await svc.history('u1', '2026-10');
    expect(r.days).toEqual([
      { date: '2026-10-03', sessions: 2, minutes: 80, calories: 500 },
      { date: '2026-10-07', sessions: 1, minutes: 60, calories: 250 },
    ]);
    expect(r.sessions[0]).toMatchObject({ id: 'a', setCount: 1 }); // set khởi động không tính
    await expect(svc.history('u1', '2026-13')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.history('u1', 'tháng 10')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('volume theo tuần: bỏ set khởi động, bài tạ cơ thể tính theo số lần, các tuần trống có giá trị 0', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-14T03:00:00Z'), doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      workoutExercise: {
        findMany: jest.fn(async () => [
          { workoutLog: { date: day('2026-10-13') }, sets: [{ weightKg: 60, reps: 10, isWarmup: false }, { weightKg: 100, reps: 5, isWarmup: true }, { weightKg: 0, reps: 12, isWarmup: false }] },
          { workoutLog: { date: day('2026-10-06') }, sets: [{ weightKg: 50, reps: 10, isWarmup: false }] },
        ]),
      },
    };
    const r = await new WorkoutsInsightsService(prisma).volumeByWeek('u1', { weeks: 3 });
    jest.useRealTimers();
    expect(r.items.map((i) => i.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(r.items.map((i) => i.volume)).toEqual([0, 500, 612]);
    expect(r.items[2].sets).toBe(2);
  });

  it('mẫu buổi tập: lưu từ buổi đã ghi, sửa mẫu không đổi buổi gốc, giới hạn số mẫu, chỉ của chính mình', async () => {
    const workout = {
      id: 'w1', userId: 'u1', name: 'Push', category: 'STRENGTH',
      exercises: [{ name: 'Bench', exerciseSource: null, exerciseRefId: null, primaryMuscle: 'Ngực', restSec: 90, sets: [{ setNumber: 1, reps: 8, weightKg: 60, isWarmup: false }] }],
    };
    const routines: any[] = [];
    const prisma: any = {
      workoutLog: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'w1' && where.userId === 'u1' ? workout : null)) },
      workoutRoutine: {
        count: jest.fn(async () => routines.length),
        create: jest.fn(async ({ data }: any) => { const r = { id: `r${routines.length}`, ...data }; routines.push(r); return r; }),
        findFirst: jest.fn(async ({ where }: any) => routines.find((r) => r.id === where.id && r.userId === where.userId) ?? null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(routines.find((r) => r.id === where.id)!, data)),
        delete: jest.fn(async () => ({})),
        findMany: jest.fn(async () => routines),
      },
    };
    const svc = new WorkoutRoutinesService(prisma);
    const r: any = await svc.createFromWorkout('u1', 'w1');
    expect(r.name).toBe('Push');
    expect(r.items[0]).toMatchObject({ name: 'Bench', primaryMuscle: 'Ngực', restSec: 90 });
    await svc.update('u1', r.id, { name: 'Push B' });
    expect(workout.name).toBe('Push'); // buổi đã ghi không đổi
    await expect(svc.update('u2', r.id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.createFromWorkout('u1', 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
    prisma.workoutRoutine.count = jest.fn(async () => MAX_ROUTINES_PER_USER);
    await expect(svc.create('u1', { name: 'n', items: [{ name: 'a', sets: [{ reps: 5, weightKg: 1 }] }] } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bài tập tự tạo: trùng tên bị chặn, chỉ xoá được bài của mình', async () => {
    const rows: any[] = [];
    const prisma: any = {
      customExercise: {
        count: jest.fn(async () => rows.length),
        findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.userId === where.userId && (where.name ? r.name === where.name : r.id === where.id)) ?? null),
        create: jest.fn(async ({ data }: any) => { const r = { id: `c${rows.length}`, ...data }; rows.push(r); return r; }),
        delete: jest.fn(async () => ({})),
      },
    };
    const svc = new WorkoutRoutinesService(prisma);
    const a: any = await svc.createCustomExercise('u1', { name: ' Đẩy tạ ống ', primaryMuscle: 'Vai' } as any);
    expect(a).toMatchObject({ name: 'Đẩy tạ ống', equipment: 'NO_EQUIPMENT', kind: 'STRENGTH' });
    await expect(svc.createCustomExercise('u1', { name: 'Đẩy tạ ống', primaryMuscle: 'Vai' } as any)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.removeCustomExercise('u2', a.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeCustomExercise('u1', a.id)).resolves.toEqual({ success: true });
  });

  it('DTO mẫu và bài tự tạo kiểm tra đầu vào', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform({ name: 'Push', items: [{ name: 'Bench', sets: [{ reps: 8, weightKg: 60 }] }] }, { type: 'body', metatype: CreateRoutineDto })).resolves.toBeDefined();
    await expect(pipe.transform({ name: 'Push', items: [] }, { type: 'body', metatype: CreateRoutineDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: 'Push', items: [{ name: 'Bench', sets: [{ reps: 500, weightKg: 60 }] }] }, { type: 'body', metatype: CreateRoutineDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ name: '', primaryMuscle: 'Vai' }, { type: 'body', metatype: CreateCustomExerciseDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Nhắc "Bạn vừa tập?" khi quên ghi buổi tập', () => {
  const NOW = new Date('2026-10-15T03:00:00Z'); // 10:00 sáng 15/10 giờ Việt Nam
  let prismaMock: any;
  const build = (dates: string[], opts: { recentNotification?: boolean; prefs?: any } = {}) => {
    prismaMock = {
      user: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Ho_Chi_Minh', notificationPrefs: opts.prefs ?? {} }) },
      workoutLog: {
        findMany: jest.fn().mockResolvedValue(
          [...dates].sort().reverse().map((d, i) => ({ id: `w${i}`, name: `Buổi ${d}`, date: day(d) })),
        ),
      },
      notification: {
        findFirst: jest.fn().mockResolvedValue(opts.recentNotification ? { id: 'n0' } : null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return new WorkoutsInsightsService(prismaMock);
  };
  const DATES = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11', '2026-10-12'];

  it('đẩy 1 thông báo WORKOUT_REMINDER vào hộp thư khi nhắc', async () => {
    const svc = build(DATES);
    const r: any = await svc.logNudge('u1', NOW);
    expect(r.notified).toBe(true);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', type: 'WORKOUT_REMINDER' }) }),
    );
  });

  it('đã có thông báo nhắc trong ngày hoặc người dùng tắt loại này → không tạo thêm', async () => {
    const a: any = await build(DATES, { recentNotification: true }).logNudge('u1', NOW);
    expect(a).toMatchObject({ show: true, notified: false });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    const b: any = await build(DATES, { prefs: { WORKOUT_REMINDER: false } }).logNudge('u1', NOW);
    expect(b).toMatchObject({ show: true, notified: false });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('tập đều cách ngày nhưng đã 3 ngày chưa ghi → nhắc', async () => {
    const svc = build(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11', '2026-10-12']);
    const r: any = await svc.logNudge('u1', NOW);
    expect(r).toMatchObject({ show: true, daysSinceLast: 3, lastWorkout: { date: '2026-10-12' } });
    expect(r.message).toContain('Bạn vừa tập xong?');
  });

  it('hôm nay đã ghi buổi tập → không nhắc', async () => {
    const svc = build(['2026-10-11', '2026-10-13', '2026-10-15']);
    expect(await svc.logNudge('u1', NOW)).toEqual({ show: false, reason: 'LOGGED_TODAY' });
  });

  it('ít hơn 3 ngày tập trong 14 ngày → không nhắc (chưa tập đều)', async () => {
    const svc = build(['2026-10-05', '2026-10-09']);
    expect(await svc.logNudge('u1', NOW)).toEqual({ show: false, reason: 'NOT_ENOUGH_HISTORY' });
  });

  it('mới nghỉ 1 ngày, chưa quá nhịp tập thường lệ → không nhắc', async () => {
    const svc = build(['2026-10-10', '2026-10-12', '2026-10-14']);
    expect(await svc.logNudge('u1', NOW)).toEqual({ show: false, reason: 'NOT_OVERDUE' });
  });
});
