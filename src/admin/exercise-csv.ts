import { parseCsv } from './food-csv';
import { EQUIPMENT, GENDER_TARGETS, LEVELS } from './dto/admin-exercise.dto';

/**
 * Nhập kho bài tập bằng CSV (J2). Cột bắt buộc: name, targetMuscle, level, equipment, genderTarget, sets, repsOrDuration,
 * restSeconds, caloriesBurnedEstimate, preparation, execution, commonMistakes, breathing. Cột tuỳ chọn: imageUrl.
 */
export const EXERCISE_CSV_REQUIRED = [
  'name', 'targetMuscle', 'level', 'equipment', 'genderTarget', 'sets', 'repsOrDuration', 'restSeconds', 'caloriesBurnedEstimate',
  'preparation', 'execution', 'commonMistakes', 'breathing',
] as const;

export const MAX_EXERCISE_CSV_ROWS = 500;

export interface CsvExerciseRow {
  name: string; targetMuscle: string; level: string; equipment: string; genderTarget: string;
  sets: number; repsOrDuration: string; restSeconds: number; caloriesBurnedEstimate: number;
  imageUrl?: string;
  instructions: { preparation: string; execution: string; commonMistakes: string; breathing: string };
}

function intIn(v: string, label: string, min: number, max: number, errs: string[]): number {
  const n = Number(v.trim().replace(',', '.'));
  if (!Number.isInteger(n) || n < min || n > max) errs.push(`${label} phải là số nguyên từ ${min} đến ${max}`);
  return n;
}

export function validateCsvExercises(text: string): { rows: CsvExerciseRow[]; errors: { line: number; message: string }[]; total: number } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'File trống' }], total: 0 };
  const header = table[0].map((h) => h.trim());
  const missing = EXERCISE_CSV_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) return { rows: [], errors: [{ line: 1, message: `Thiếu cột: ${missing.join(', ')}` }], total: 0 };
  const data = table.slice(1);
  if (data.length > MAX_EXERCISE_CSV_ROWS) return { rows: [], errors: [{ line: 1, message: `Tối đa ${MAX_EXERCISE_CSV_ROWS} dòng mỗi lần nhập` }], total: data.length };

  const idx = (c: string) => header.indexOf(c);
  const seen = new Set<string>();
  const rows: CsvExerciseRow[] = [];
  const errors: { line: number; message: string }[] = [];
  data.forEach((cells, i) => {
    const line = i + 2;
    const errs: string[] = [];
    const get = (c: string) => (cells[idx(c)] ?? '').trim();
    const name = get('name');
    if (!name) errs.push('Thiếu tên bài');
    else if (name.length > 120) errs.push('Tên bài tối đa 120 ký tự');
    if (name && seen.has(name.toLowerCase())) errs.push('Trùng tên với một dòng khác trong file');
    seen.add(name.toLowerCase());
    if (!get('targetMuscle')) errs.push('Thiếu nhóm cơ');
    const level = get('level').toUpperCase();
    if (!(LEVELS as readonly string[]).includes(level)) errs.push(`level phải là ${LEVELS.join(', ')}`);
    const equipment = get('equipment').toUpperCase();
    if (!(EQUIPMENT as readonly string[]).includes(equipment)) errs.push(`equipment phải là ${EQUIPMENT.join(', ')}`);
    const gender = get('genderTarget').toUpperCase();
    if (!(GENDER_TARGETS as readonly string[]).includes(gender)) errs.push(`genderTarget phải là ${GENDER_TARGETS.join(', ')}`);
    const sets = intIn(get('sets'), 'sets', 1, 20, errs);
    const rest = intIn(get('restSeconds'), 'restSeconds', 0, 600, errs);
    const cal = Number(get('caloriesBurnedEstimate').replace(',', '.'));
    if (!Number.isFinite(cal) || cal < 0 || cal > 500) errs.push('caloriesBurnedEstimate phải là số từ 0 đến 500');
    if (!get('repsOrDuration')) errs.push('Thiếu repsOrDuration');
    for (const k of ['preparation', 'execution', 'commonMistakes', 'breathing'] as const) if (!get(k)) errs.push(`Thiếu ${k}`);
    const image = idx('imageUrl') >= 0 ? get('imageUrl') : '';
    if (image && !/^https?:\/\//i.test(image)) errs.push('imageUrl phải bắt đầu bằng http:// hoặc https://');

    if (errs.length > 0) {
      errors.push({ line, message: errs.join('; ') });
      return;
    }
    rows.push({
      name, targetMuscle: get('targetMuscle'), level, equipment, genderTarget: gender, sets, repsOrDuration: get('repsOrDuration'),
      restSeconds: rest, caloriesBurnedEstimate: cal, ...(image ? { imageUrl: image } : {}),
      instructions: { preparation: get('preparation'), execution: get('execution'), commonMistakes: get('commonMistakes'), breathing: get('breathing') },
    });
  });
  return { rows, errors, total: data.length };
}
