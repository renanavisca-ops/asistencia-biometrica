import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplate, mondayOf, parseTime, parseWeekly } from '../lib/weekly';

const fill = async (buf: ArrayBuffer, edit: (ws: ExcelJS.Worksheet) => void) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); edit(wb.getWorksheet('Horario')!);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
};

describe('formato Excel del horario semanal', () => {
  it('lee horas escritas de distintas formas', () => {
    expect(parseTime('08:00')).toBe('08:00'); expect(parseTime('8:30')).toBe('08:30'); expect(parseTime('8')).toBe('08:00');
    expect(parseTime('8:00 pm')).toBe('20:00'); expect(parseTime('12:15 a.m.')).toBe('00:15'); expect(parseTime('14.45')).toBe('14:45');
    expect(parseTime(0.375)).toBe('09:00'); expect(parseTime(new Date(Date.UTC(1899, 11, 30, 7, 45)))).toBe('07:45');
    expect(parseTime('descanso')).toBeNull(); expect(parseTime('')).toBeNull(); expect(parseTime(null)).toBeNull();
    expect(parseTime('25:00')).toBeUndefined(); expect(parseTime('mañana')).toBeUndefined();
  });

  it('lunes de cualquier fecha', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16'); expect(mondayOf('2026-11-16')).toBe('2026-11-16'); expect(mondayOf('2026-11-22')).toBe('2026-11-16');
  });

  it('plantilla → llenado → lectura', async () => {
    const tpl = await buildTemplate({ storeCode: 'T1', storeName: 'Tienda 1', weekStart: '2026-11-23', tolerance: 10,
      employees: [{ code: 'E01', name: 'Pérez, Ana', days: { 1: { start: '08:00', end: '16:00' } } }, { code: 'E02', name: 'Gómez, Luis', days: {} }] });
    const filled = await fill(tpl, (ws) => {
      ws.getCell('E6').value = '9:00'; ws.getCell('F6').value = '5:00 pm';        // martes de Ana
      ws.getCell('C7').value = 0.25; ws.getCell('D7').value = '14:00';            // lunes de Luis (06:00 como fracción de día)
      ws.getCell('O7').value = 'descanso';                                        // domingo de Luis
    });
    const r = await parseWeekly(filled);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet).toMatchObject({ storeCode: 'T1', weekStart: '2026-11-23', tolerance: 10 });
    expect(r.sheet.employees).toEqual([
      { code: 'E01', name: 'Pérez, Ana', days: { 1: { start: '08:00', end: '16:00' }, 2: { start: '09:00', end: '17:00' } } },
      { code: 'E02', name: 'Gómez, Luis', days: { 1: { start: '06:00', end: '14:00' } } },
    ]);
  });

  it('señala los errores con fila y día', async () => {
    const tpl = await buildTemplate({ storeCode: 'T1', weekStart: '2026-11-23', tolerance: 5, employees: [{ code: 'E01', name: 'Ana', days: {} }] });
    const bad = await fill(tpl, (ws) => { ws.getCell('B2').value = '2026-11-24'; ws.getCell('C6').value = 'temprano'; ws.getCell('F6').value = '17:00'; });
    const r = await parseWeekly(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(expect.arrayContaining([
      'La semana debe iniciar un lunes (2026-11-24 no es lunes).',
      'Fila 6 (E01), Lunes: no se entiende la hora de entrada «temprano».',
      'Fila 6 (E01), Martes: tiene salida pero no entrada.',
    ]));
    expect((await parseWeekly(new TextEncoder().encode('no es excel').buffer as ArrayBuffer)).ok).toBe(false);
  });
});
