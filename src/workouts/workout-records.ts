import { normalizeName } from '../ai/food-matcher';

/** Kỷ lục cá nhân và thống kê khối lượng tập (BR-10.8). Hàm thuần để test không cần cơ sở dữ liệu. */

/** Epley chỉ đáng tin với set không quá số lần này (`workout.prMaxRepsForE1rm`). */
export const PR_MAX_REPS_FOR_E1RM = 12;

export type RecordType = 'MAX_WEIGHT' | 'MAX_REPS_AT_WEIGHT' | 'EST_1RM' | 'MAX_REPS_BODYWEIGHT';

export interface SetForRecords {
  setId: string;
  workoutId: string;
  weightKg: number;
  reps: number;
  isWarmup: boolean;
  achievedAt: Date;
}

export interface RecordValue {
  type: RecordType;
  /** Mức tạ của kỷ lục MAX_REPS_AT_WEIGHT; các loại khác là 0. */
  weightKey: number;
  value: number;
  reps: number | null;
  weightKg: number | null;
  setId: string;
  workoutId: string;
  achievedAt: Date;
}

/** Khoá bài tập: bài trong kho/bài tự tạo theo mã, bài cũ chỉ có tên theo tên không dấu. */
export function exerciseKey(ex: { exerciseSource?: string | null; exerciseRefId?: string | null; name: string }): string {
  if (ex.exerciseSource && ex.exerciseRefId) return `${ex.exerciseSource}:${ex.exerciseRefId}`;
  return `name:${normalizeName(ex.name)}`;
}

/** 1RM ước tính theo Epley: weight × (1 + reps/30). */
export function epley1rm(weightKg: number, reps: number): number {
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Tính kỷ lục từ mọi set của MỘT bài tập. Set khởi động không tính. Hoà giá trị thì giữ set đạt sớm nhất.
 * - MAX_WEIGHT: tạ cao nhất (tạ > 0).
 * - MAX_REPS_AT_WEIGHT: số lần cao nhất ở từng mức tạ (tạ > 0).
 * - EST_1RM: 1RM Epley cao nhất, chỉ với set có reps ≤ 12 và tạ > 0.
 * - MAX_REPS_BODYWEIGHT: số lần cao nhất của set không tạ (tạ = 0).
 */
export function computeRecords(sets: SetForRecords[]): RecordValue[] {
  const valid = sets
    .filter((s) => !s.isWarmup && s.reps > 0 && s.weightKg >= 0)
    .sort((a, b) => +a.achievedAt - +b.achievedAt);
  const best = new Map<string, RecordValue>();
  const consider = (type: RecordType, weightKey: number, value: number, s: SetForRecords) => {
    const key = `${type}|${weightKey}`;
    const cur = best.get(key);
    if (!cur || value > cur.value) {
      best.set(key, {
        type,
        weightKey,
        value,
        reps: s.reps,
        weightKg: s.weightKg > 0 ? s.weightKg : null,
        setId: s.setId,
        workoutId: s.workoutId,
        achievedAt: s.achievedAt,
      });
    }
  };
  for (const s of valid) {
    if (s.weightKg > 0) {
      consider('MAX_WEIGHT', 0, s.weightKg, s);
      consider('MAX_REPS_AT_WEIGHT', s.weightKg, s.reps, s);
      if (s.reps <= PR_MAX_REPS_FOR_E1RM) consider('EST_1RM', 0, epley1rm(s.weightKg, s.reps), s);
    } else {
      consider('MAX_REPS_BODYWEIGHT', 0, s.reps, s);
    }
  }
  return [...best.values()];
}

/** Những kỷ lục MỚI hoặc được phá của `after` so với `before` (tạo mới hoặc giá trị cao hơn). */
export function newRecordsOf(before: RecordValue[], after: RecordValue[]): RecordValue[] {
  const was = new Map(before.map((r) => [`${r.type}|${r.weightKey}`, r.value]));
  return after.filter((r) => {
    const prev = was.get(`${r.type}|${r.weightKey}`);
    if (prev !== undefined) return r.value > prev;
    // Mức tạ mới chưa từng tập không phải "kỷ lục đáng khoe"
    if (r.type === 'MAX_REPS_AT_WEIGHT') return false;
    // Bài lần đầu tập: chỉ báo mốc đầu tiên (tạ cao nhất / số lần tạ cơ thể), không báo cả bộ kỷ lục
    if (before.length === 0) return r.type === 'MAX_WEIGHT' || r.type === 'MAX_REPS_BODYWEIGHT';
    return true;
  });
}

/** Volume một set: tạ × số lần; bài tạ cơ thể (tạ 0) tính theo số lần. */
export function setVolume(weightKg: number, reps: number): number {
  return round2(weightKg > 0 ? weightKg * reps : reps);
}

/** Volume buổi tập: chỉ set không khởi động. */
export function sessionVolume(exercises: { sets: { weightKg: number; reps: number; isWarmup?: boolean }[] }[]): number {
  let total = 0;
  for (const ex of exercises) {
    for (const s of ex.sets ?? []) {
      if (!s.isWarmup) total += setVolume(s.weightKg ?? 0, s.reps ?? 0);
    }
  }
  return round2(total);
}
