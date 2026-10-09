/** BOM UTF-8 để Excel đọc đúng tiếng Việt khi mở file CSV. */
const BOM = '﻿';

/**
 * Chuẩn hoá một ô CSV:
 * - null/undefined → ô rỗng; Date → ISO; boolean/số → chuỗi.
 * - Chống "CSV injection": ô bắt đầu bằng = + - @ (hoặc tab/CR) có thể bị Excel hiểu là công thức, nên thêm dấu ' phía
 *   trước. Số âm hợp lệ (ví dụ -0.5 kg) KHÔNG bị thêm dấu vì giá trị số được ghi nguyên.
 * - Có dấu phẩy, nháy kép hoặc xuống dòng thì đặt trong nháy kép và nhân đôi nháy kép bên trong.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') text = value ? 'true' : 'false';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Tạo nội dung CSV (UTF-8 có BOM, dòng kết thúc CRLF theo RFC 4180). */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): Buffer {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8');
}
