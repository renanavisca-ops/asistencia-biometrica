/**
 * Formato Excel del horario semanal de una sucursal: generación de la plantilla y lectura del archivo lleno.
 *
 *   A1 «Tienda»            B1 código de la sucursal (se valida al importar)   C1 nombre
 *   A2 «Semana (lunes)»    B2 fecha AAAA-MM-DD del lunes
 *   A3 «Tolerancia (min)»  B3 minutos de tolerancia
 *   Fila 5: Código | Empleado | Lunes entrada | Lunes salida | … | Domingo salida
 *   Fila 6 en adelante: un empleado por fila. Celda de entrada vacía (o «descanso»/«libre») = día sin control.
 */
import ExcelJS from 'exceljs';

export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const HEADER_ROW = 5;

export type WeeklyEmployee = { code: string; name: string; days: Record<number, { start: string; end: string | null }> };
export type WeeklySheet = { storeCode: string; storeName?: string; weekStart: string; tolerance: number; employees: WeeklyEmployee[] };
export type ParseResult = { ok: true; sheet: WeeklySheet } | { ok: false; errors: string[] };

const pad = (n: number) => String(n).padStart(2, '0');

/** Lunes de la semana de una fecha (AAAA-MM-DD). */
export function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Convierte lo que haya en una celda de hora a «HH:MM». null = vacío/descanso; undefined = no se entiende. */
export function parseTime(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'result' in v) return parseTime((v as { result: unknown }).result); // fórmula
  if (typeof v === 'object' && v !== null && 'richText' in v) return parseTime((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(''));
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`; // celda con formato de hora
  if (typeof v === 'number') {
    if (v >= 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; } // fracción del día
    if (Number.isInteger(v) && v >= 0 && v <= 23) return `${pad(v)}:00`;
    return undefined;
  }
  const s = String(v).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || ['-', '—', 'descanso', 'libre', 'x', 'off'].includes(s)) return null;
  const m = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/);
  if (!m) return undefined;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  const ap = m[3]?.replace(/[\s.]/g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

const cellText = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in (v as object)) return cellText((v as { result: unknown }).result);
  if (typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text);
  return String(v).trim();
};

export async function buildTemplate(sheet: WeeklySheet): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Asistencia Tienda';
  const ws = wb.addWorksheet('Horario');
  ws.getCell('A1').value = 'Tienda'; ws.getCell('B1').value = sheet.storeCode; ws.getCell('C1').value = sheet.storeName ?? '';
  ws.getCell('A2').value = 'Semana (lunes)'; ws.getCell('B2').value = sheet.weekStart;
  ws.getCell('A3').value = 'Tolerancia (min)'; ws.getCell('B3').value = sheet.tolerance;
  ws.getCell('A4').value = 'Escriba las horas como 08:00 o 8:00 pm. Deje la entrada vacía (o escriba «descanso») en los días libres. No cambie las filas 1 a 5.';
  ws.getCell('A4').font = { italic: true, color: { argb: 'FF6B7280' } };
  for (const c of ['A1', 'A2', 'A3']) ws.getCell(c).font = { bold: true };
  const head = ['Código', 'Empleado', ...DAY_NAMES.flatMap((d) => [`${d} entrada`, `${d} salida`])];
  const hr = ws.getRow(HEADER_ROW); head.forEach((h, i) => { hr.getCell(i + 1).value = h; }); hr.font = { bold: true };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }; });
  sheet.employees.forEach((e, i) => {
    const r = ws.getRow(HEADER_ROW + 1 + i);
    r.getCell(1).value = e.code; r.getCell(2).value = e.name;
    for (let d = 1; d <= 7; d++) {
      r.getCell(1 + d * 2).value = e.days[d]?.start ?? null;
      r.getCell(2 + d * 2).value = e.days[d]?.end ?? null;
    }
  });
  ws.getColumn(1).width = 16; ws.getColumn(2).width = 28;
  for (let c = 3; c <= 16; c++) { ws.getColumn(c).width = 11; ws.getColumn(c).numFmt = '@'; }
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function parseWeekly(buf: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { return { ok: false, errors: ['El archivo no es un Excel (.xlsx) válido.'] }; }
  const ws = wb.getWorksheet('Horario') ?? wb.worksheets[0];
  if (!ws) return { ok: false, errors: ['El archivo no tiene hojas.'] };
  const errors: string[] = [];
  const storeCode = cellText(ws.getCell('B1').value);
  const weekRaw = ws.getCell('B2').value;
  const weekStart = weekRaw instanceof Date ? weekRaw.toISOString().slice(0, 10) : cellText(weekRaw);
  const tol = Number(cellText(ws.getCell('B3').value) || '5');
  if (!storeCode) errors.push('Falta el código de la tienda (celda B1).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) errors.push('La semana (celda B2) debe tener el formato AAAA-MM-DD.');
  else if (mondayOf(weekStart) !== weekStart) errors.push(`La semana debe iniciar un lunes (${weekStart} no es lunes).`);
  if (!Number.isInteger(tol) || tol < 0 || tol > 240) errors.push('La tolerancia (celda B3) debe ser un número entero de 0 a 240.');
  if (cellText(ws.getRow(HEADER_ROW).getCell(1).value).toLowerCase() !== 'código') errors.push('No se encontró el encabezado en la fila 5 (use la plantilla descargada).');
  const employees: WeeklyEmployee[] = [];
  const seen = new Set<string>();
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(1).value);
    if (!code) continue;
    if (seen.has(code)) { errors.push(`Fila ${r}: el código ${code} está repetido.`); continue; }
    seen.add(code);
    const days: WeeklyEmployee['days'] = {};
    for (let d = 1; d <= 7; d++) {
      const st = parseTime(row.getCell(1 + d * 2).value), en = parseTime(row.getCell(2 + d * 2).value);
      if (st === undefined) errors.push(`Fila ${r} (${code}), ${DAY_NAMES[d - 1]}: no se entiende la hora de entrada «${cellText(row.getCell(1 + d * 2).value)}».`);
      if (en === undefined) errors.push(`Fila ${r} (${code}), ${DAY_NAMES[d - 1]}: no se entiende la hora de salida «${cellText(row.getCell(2 + d * 2).value)}».`);
      if (st === null && en) errors.push(`Fila ${r} (${code}), ${DAY_NAMES[d - 1]}: tiene salida pero no entrada.`);
      if (st) days[d] = { start: st, end: en ?? null };
    }
    employees.push({ code, name: cellText(row.getCell(2).value), days });
  }
  if (!employees.length) errors.push('No hay empleados en el archivo (desde la fila 6).');
  if (errors.length) return { ok: false, errors: errors.slice(0, 30) };
  return { ok: true, sheet: { storeCode, weekStart, tolerance: tol, employees } };
}

/** Filas para import_weekly_schedule. */
export const toRpcRows = (s: WeeklySheet) => s.employees.map((e) => ({ code: e.code, days: Object.fromEntries(Object.entries(e.days).map(([d, v]) => [d, { start: v.start, end: v.end ?? '' }])) }));
