import { ALLERGEN_CODES } from '../recommendations/data/food-safety-tags.data';

/**
 * Nhập kho món bằng CSV (J2): đọc, kiểm từng dòng, báo lỗi theo dòng. Chưa ghi gì; việc ghi chỉ xảy ra khi admin xác nhận.
 * Cột bắt buộc: name, category, servingSize, calories, protein, carb, fat, allergens, containsMeat, containsFish,
 * containsEgg, containsDairy, containsPork, dataSource. Cột tuỳ chọn: aliases, note. Danh sách cách nhau bằng `;`.
 */
export const CSV_REQUIRED = [
  'name', 'category', 'servingSize', 'calories', 'protein', 'carb', 'fat',
  'allergens', 'containsMeat', 'containsFish', 'containsEgg', 'containsDairy', 'containsPork', 'dataSource',
] as const;

export const MAX_CSV_ROWS = 1000;

export interface CsvFoodRow {
  name: string; category: string; servingSize: string;
  calories: number; protein: number; carb: number; fat: number;
  allergens: string[];
  containsMeat: boolean; containsFish: boolean; containsEgg: boolean; containsDairy: boolean; containsPork: boolean;
  dataSource: string; aliases: string[]; note?: string;
}

export interface CsvRowError { line: number; message: string }

/** Tách CSV theo RFC 4180: có ngoặc kép, dấu phẩy và xuống dòng trong ô, `""` là một dấu ngoặc kép. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const BOOL: Record<string, boolean> = { true: true, false: false, '1': true, '0': false, yes: true, no: false, co: true, khong: false, có: true, không: false };

function num(v: string, label: string, max: number, errors: string[]): number {
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) errors.push(`${label} phải là số từ 0 đến ${max}`);
  return n;
}

export function validateCsvFoods(text: string): { rows: CsvFoodRow[]; errors: CsvRowError[]; total: number } {
  const table = parseCsv(text);
  const errors: CsvRowError[] = [];
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'File trống' }], total: 0 };
  const header = table[0].map((h) => h.trim());
  const missing = CSV_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) return { rows: [], errors: [{ line: 1, message: `Thiếu cột: ${missing.join(', ')}` }], total: 0 };
  const data = table.slice(1);
  if (data.length > MAX_CSV_ROWS) return { rows: [], errors: [{ line: 1, message: `Tối đa ${MAX_CSV_ROWS} dòng mỗi lần nhập` }], total: data.length };

  const idx = (c: string) => header.indexOf(c);
  const seen = new Set<string>();
  const rows: CsvFoodRow[] = [];
  data.forEach((cells, i) => {
    const line = i + 2;
    const errs: string[] = [];
    const get = (c: string) => (cells[idx(c)] ?? '').trim();
    const name = get('name');
    if (!name) errs.push('Thiếu tên món');
    if (name.length > 120) errs.push('Tên món tối đa 120 ký tự');
    if (name && seen.has(name.toLowerCase())) errs.push('Trùng tên với một dòng khác trong file');
    seen.add(name.toLowerCase());
    if (!get('category')) errs.push('Thiếu nhóm món');
    if (!get('servingSize')) errs.push('Thiếu khẩu phần chuẩn');
    if (!get('dataSource')) errs.push('Thiếu nguồn số liệu');

    const calories = num(get('calories'), 'calories', 5000, errs);
    const protein = num(get('protein'), 'protein', 500, errs);
    const carb = num(get('carb'), 'carb', 500, errs);
    const fat = num(get('fat'), 'fat', 500, errs);

    const allergens = get('allergens').split(';').map((a) => a.trim().toUpperCase()).filter(Boolean);
    const bad = allergens.filter((a) => !(ALLERGEN_CODES as readonly string[]).includes(a));
    if (bad.length > 0) errs.push(`Mã dị ứng không hợp lệ: ${bad.join(', ')} (hợp lệ: ${ALLERGEN_CODES.join(', ')})`);

    const flags: Record<string, boolean> = {};
    for (const f of ['containsMeat', 'containsFish', 'containsEgg', 'containsDairy', 'containsPork']) {
      const v = BOOL[get(f).toLowerCase()];
      if (v === undefined) errs.push(`${f} phải là true/false`);
      flags[f] = v ?? false;
    }

    if (errs.length > 0) {
      errors.push({ line, message: errs.join('; ') });
      return;
    }
    rows.push({
      name, category: get('category'), servingSize: get('servingSize'), calories, protein, carb, fat, allergens,
      containsMeat: flags.containsMeat, containsFish: flags.containsFish, containsEgg: flags.containsEgg,
      containsDairy: flags.containsDairy, containsPork: flags.containsPork,
      dataSource: get('dataSource'),
      aliases: idx('aliases') >= 0 ? get('aliases').split(';').map((a) => a.trim()).filter(Boolean).slice(0, 10) : [],
      note: idx('note') >= 0 ? get('note') || undefined : undefined,
    });
  });
  return { rows, errors, total: data.length };
}
