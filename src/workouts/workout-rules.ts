/** Quy tắc kiểm tra buổi tập (BR-10.4). Hàm thuần; hằng số sẽ chuyển sang bảng tham số khi làm J3. */
export const WORKOUT_LIMITS = {
  repsMax: 100, // workout.repsMax
  weightMaxKg: 500, // workout.weightMaxKg
  durationMaxMin: 600,
  restSecMax: 900,
  /** Tạ gấp hơn mức này so với lần trước cùng bài thì cảnh báo mềm (workout.weightJumpWarnFactor). */
  weightJumpWarnFactor: 2,
  /** Phiên dở quá số giờ này thì app hỏi lưu hay huỷ (workout.abandonedSessionHours). */
  abandonedSessionHours: 12,
  /** MET dùng khi loại bài không xác định (workout.defaultMetIfUnknown). */
  defaultMetIfUnknown: 4.0,
} as const;

export interface SessionInput {
  category: string;
  durationMinutes: number;
  exercises?: { name: string; sets: { reps: number; weightKg: number; isWarmup?: boolean }[] }[];
}

/**
 * Buổi tập không đạt thì không lưu. STRENGTH phải có ít nhất một bài và một set KHÔNG khởi động (buổi tập tạ toàn
 * set khởi động hoặc rỗng là dữ liệu vô nghĩa). Các loại cardio chỉ cần thời lượng (đã kiểm tra ở DTO).
 */
export function validateSession(input: SessionInput): string[] {
  const errors: string[] = [];
  if (input.category === 'STRENGTH') {
    const exercises = input.exercises ?? [];
    if (exercises.length === 0) {
      errors.push('Buổi tập tạ phải có ít nhất một bài tập');
    } else if (!exercises.some((e) => (e.sets ?? []).some((s) => !s.isWarmup))) {
      errors.push('Buổi tập tạ phải có ít nhất một set không phải khởi động');
    }
  }
  if (!(input.durationMinutes >= 1) || input.durationMinutes > WORKOUT_LIMITS.durationMaxMin) {
    errors.push(`Thời lượng phải từ 1 đến ${WORKOUT_LIMITS.durationMaxMin} phút`);
  }
  return errors;
}

export interface JumpWarning {
  name: string;
  previousKg: number;
  currentKg: number;
}

/**
 * Cảnh báo mềm khi tạ cao nhất của một bài gấp hơn 2 lần lần trước (hay nhầm kg và lb). Không chặn việc lưu.
 */
export function weightJumpWarnings(
  current: { key: string; name: string; maxWeightKg: number }[],
  previousMax: Map<string, number>,
  factor: number = WORKOUT_LIMITS.weightJumpWarnFactor,
): JumpWarning[] {
  const out: JumpWarning[] = [];
  for (const c of current) {
    const prev = previousMax.get(c.key);
    if (prev && prev > 0 && c.maxWeightKg > prev * factor) {
      out.push({ name: c.name, previousKg: prev, currentKg: c.maxWeightKg });
    }
  }
  return out;
}

/** Tuần ISO bắt đầu từ Thứ Hai: khoá ngày của Thứ Hai trong tuần chứa `dayKey`. */
export function mondayKeyOf(dayKey: string): string {
  const d = new Date(dayKey + 'T00:00:00Z');
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

/** Nhóm hệ số vận động theo số buổi tập mỗi tuần (BR-03.2): 0 / 1–2 / 3–4 / 5–6 / 7. */
export function activityBucket(daysPerWeek: number): number {
  if (daysPerWeek <= 0) return 0;
  if (daysPerWeek <= 2) return 1;
  if (daysPerWeek <= 4) return 2;
  if (daysPerWeek <= 6) return 3;
  return 4;
}
