import { describe, expect, it } from 'vitest';
import { summarizeWorkdays, type SessionLike } from '../src/index.ts';

const tz = 'America/Guatemala'; // UTC-6
const at = (h: number, m = 0, day = 9) => Date.UTC(2026, 10, day, h + 6, m); // hora local → UTC
const s = (o: number | null, c: number | null, state: SessionLike['state'] = 'closed', employeeId = 'e1'): SessionLike =>
  ({ employeeId, openedAtMs: o, closedAtMs: c, state, needsReview: false });
const opts = { timeZone: tz, pauseMinMinutes: 15, pauseMaxMinutes: 150 };

describe('resumen por jornada con pausas deducidas', () => {
  it('jornada con almuerzo: 8:00–12:00, 13:00–17:00', () => {
    const [w] = summarizeWorkdays([s(at(8), at(12)), s(at(13), at(17))], opts);
    expect(w).toMatchObject({ date: '2026-11-09', firstInMs: at(8), lastOutMs: at(17), presentMinutes: 480, pauseMinutes: 60, sessions: 2, open: false });
    expect(w!.pauses).toEqual([{ fromMs: at(12), toMs: at(13), minutes: 60, kind: 'pausa' }]);
  });
  it('salida y reentrada breve (5 min) se marca como breve', () => {
    const [w] = summarizeWorkdays([s(at(8), at(10)), s(at(10, 5), at(12))], opts);
    expect(w!.pauses[0]!.kind).toBe('breve');
  });
  it('hueco mayor al máximo → jornadas distintas', () => {
    expect(summarizeWorkdays([s(at(8), at(12)), s(at(18), at(22))], opts)).toHaveLength(2);
  });
  it('turno nocturno 22:00–06:00 queda en la fecha de entrada', () => {
    const [w] = summarizeWorkdays([s(at(22), at(6, 0, 10))], opts);
    expect(w).toMatchObject({ date: '2026-11-09', presentMinutes: 480 });
  });
  it('sesión abierta y salida omitida', () => {
    const r = summarizeWorkdays([s(at(8, 0, 8), null, 'missing_out'), s(at(8), null, 'open')], opts);
    expect(r.map((x) => [x.date, x.open, x.needsReview])).toEqual([['2026-11-09', true, false], ['2026-11-08', false, true]]);
  });
  it('separa por empleado', () => {
    expect(summarizeWorkdays([s(at(8), at(12)), s(at(8), at(12), 'closed', 'e2')], opts)).toHaveLength(2);
  });
});
