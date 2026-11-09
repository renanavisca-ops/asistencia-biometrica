import { describe, expect, it } from 'vitest';
import { decideNextEvent, DEFAULT_POLICY, shiftSummary, summarizeWorkdays, type LastEventRef } from '../src/index.ts';

const H = 3_600_000;
const policy = DEFAULT_POLICY;
const t0 = Date.UTC(2026, 10, 8, 8, 0, 0);
const last = (eventType: 'IN' | 'OUT', occurredAtMs: number, mono: number | null = null, bootId: string | null = null): LastEventRef => ({
  id: 'e1', eventType, occurredAtMs, monotonicMs: mono, bootId,
});

describe('decideNextEvent', () => {
  it('sin historial → ENTRADA', () => {
    const d = decideNextEvent({ last: null, nowMs: t0, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'IN', previousSessionMissingOut: false });
  });
  it('tras ENTRADA → SALIDA', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 8 * H, nowMonotonicMs: null, bootId: null, policy, outKind: 'end' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['out_end'] });
  });
  it('tras SALIDA → ENTRADA', () => {
    const d = decideNextEvent({ last: last('OUT', t0), nowMs: t0 + H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'IN' });
  });
  it('dentro de la ventana anti-doble → duplicado sin alternar', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 30_000, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'duplicate', secondsSince: 30 });
  });
  it('turno nocturno que cruza medianoche → SALIDA normal', () => {
    const start = Date.UTC(2026, 10, 8, 22, 0, 0);
    const d = decideNextEvent({ last: last('IN', start), nowMs: start + 8 * H, nowMonotonicMs: null, bootId: null, policy, outKind: 'end' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['out_end'] });
  });
  it('permanencia larga → SALIDA marcada', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 15 * H, nowMonotonicMs: null, bootId: null, policy, outKind: 'end' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['out_end', 'long_session_out'] });
  });
  it('sesión caducada → ENTRADA nueva + salida omitida (no inventa la salida)', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 26 * H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'IN', previousSessionMissingOut: true, flags: ['stale_open_session'] });
  });
  it('usa el reloj monotónico si el usuario adelanta la hora del teléfono', () => {
    // La hora de pared salta 10 h pero solo pasaron 20 s reales en el mismo arranque.
    const d = decideNextEvent({
      last: last('IN', t0, 1_000_000, 'boot-a'), nowMs: t0 + 10 * H, nowMonotonicMs: 1_020_000, bootId: 'boot-a', policy,
    });
    expect(d.kind).toBe('duplicate');
  });
  it('reloj que retrocede → registra con bandera, no lo trata como duplicado', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 - 2 * H, nowMonotonicMs: null, bootId: null, policy, outKind: 'end' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['clock_regression', 'out_end'] });
  });
});

describe('salida: la persona elige almuerzo o fin de turno', () => {
  const p = { ...policy, minSessionMinutes: 30 };
  it('con sesión abierta y sin elección → pregunta, no registra', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 4 * H, nowMonotonicMs: null, bootId: null, policy: p });
    expect(d).toMatchObject({ kind: 'choose_out', minutesSince: 240, early: false });
  });
  it('3 min después de entrar → pregunta con aviso de salida temprana', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 3 * 60_000, nowMonotonicMs: null, bootId: null, policy: p });
    expect(d).toMatchObject({ kind: 'choose_out', minutesSince: 3, early: true });
  });
  it('fin de turno temprano elegido → SALIDA con banderas', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 3 * 60_000, nowMonotonicMs: null, bootId: null, policy: p, outKind: 'end' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['out_end', 'early_out_confirmed'] });
  });
  it('almuerzo → SALIDA con bandera out_break', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 4 * H, nowMonotonicMs: null, bootId: null, policy: p, outKind: 'break' });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['out_break'] });
  });
  it('regreso del almuerzo → ENTRADA con bandera in_after_break', () => {
    const d = decideNextEvent({ last: { ...last('OUT', t0), outKind: 'break' }, nowMs: t0 + H, nowMonotonicMs: null, bootId: null, policy: p });
    expect(d).toMatchObject({ kind: 'record', eventType: 'IN', flags: ['in_after_break'] });
  });
  it('dentro de la ventana anti-doble sigue siendo duplicado (sin preguntar)', () => {
    expect(decideNextEvent({ last: last('IN', t0), nowMs: t0 + 30_000, nowMonotonicMs: null, bootId: null, policy: p }).kind).toBe('duplicate');
  });
  it('tras una SALIDA de fin de turno, entrar de nuevo es directo', () => {
    expect(decideNextEvent({ last: { ...last('OUT', t0), outKind: 'end' }, nowMs: t0 + 5 * 60_000, nowMonotonicMs: null, bootId: null, policy: p }))
      .toMatchObject({ kind: 'record', eventType: 'IN', flags: [] });
  });
});

describe('resumen del turno al salir', () => {
  const ev = (eventType: 'IN' | 'OUT', h: number, outKind: 'break' | 'end' | null = null) => ({ eventType, occurredAtMs: t0 + h * H, outKind });
  it('8 h con 1 h de almuerzo', () => {
    const r = shiftSummary([ev('IN', 0), ev('OUT', 4, 'break'), ev('IN', 5), ev('OUT', 9, 'end')], { pauseMaxMinutes: 150 });
    expect(r).toMatchObject({ workedMinutes: 480, breakMinutes: 60, startMs: t0, complete: true });
  });
  it('no mezcla el turno de ayer', () => {
    const r = shiftSummary([ev('IN', -24), ev('OUT', -16, 'end'), ev('IN', 0), ev('OUT', 8, 'end')], { pauseMaxMinutes: 150 });
    expect(r).toMatchObject({ workedMinutes: 480, breakMinutes: 0, startMs: t0 });
  });
  it('jornada con almuerzo elegido: el panel la muestra como una sola jornada con «almuerzo»', () => {
    const s = (o: number, c: number | null, outKind: 'break' | 'end' | null) => ({ employeeId: 'e', openedAtMs: t0 + o * H, closedAtMs: c == null ? null : t0 + c * H,
      state: c == null ? 'open' as const : 'closed' as const, needsReview: false, outKind });
    const [d] = summarizeWorkdays([s(0, 4, 'break'), s(7, 11, 'end')], { timeZone: 'UTC', pauseMinMinutes: 15, pauseMaxMinutes: 150 });
    expect(d).toMatchObject({ presentMinutes: 480, pauseMinutes: 180, open: false, onBreak: false });
    expect(d!.pauses[0]!.kind).toBe('almuerzo');
    const days = summarizeWorkdays([s(0, 4, 'end'), s(5, 9, 'end')], { timeZone: 'UTC', pauseMinMinutes: 15, pauseMaxMinutes: 150 });
    expect(days).toHaveLength(2); // fin de turno elegido: lo siguiente es otra jornada aunque pase poco tiempo
  });
});
