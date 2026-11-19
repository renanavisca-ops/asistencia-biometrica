import ExcelJS from 'exceljs';
import type { Report } from './reports-core';

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // evita inyección de fórmulas
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const cell = (v: unknown) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v);

/** CSV UTF-8 con BOM (Excel lo abre con acentos correctos). */
export const toCsv = (rep: Report) => '﻿' + [rep.header, ...rep.rows].map((r) => r.map(esc).join(',')).join('\r\n');

/** Libro Excel: hoja de datos + hoja «Resumen» con totales y notas del método. */
export async function toXlsx(rep: Report, from: string, to: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Asistencia Tienda';
  const ws = wb.addWorksheet(rep.title.slice(0, 31));
  ws.addRow(rep.header).font = { bold: true };
  for (const r of rep.rows) ws.addRow(r.map(cell));
  ws.columns.forEach((c) => { c.width = 18; });
  const s = wb.addWorksheet('Resumen');
  s.addRow([rep.title, `${from} a ${to}`]).font = { bold: true };
  for (const [k, v] of rep.summary) s.addRow([k, v]);
  s.addRow([]);
  for (const n of rep.notes) s.addRow([n]);
  s.getColumn(1).width = 60;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
