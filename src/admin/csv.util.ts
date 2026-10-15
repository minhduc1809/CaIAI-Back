/**
 * CSV phía máy chủ cho xuất dữ liệu của admin: bọc ngoặc kép, chống formula injection (ô bắt đầu bằng = + - @ tab CR),
 * BOM để Excel đọc đúng tiếng Việt. Chỉ truyền vào các trường được phép xuất (không token, mật khẩu, dữ liệu sức khỏe).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

