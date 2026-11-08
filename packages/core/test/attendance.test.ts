import { describe, expect, it } from 'vitest';
import { decideNextEvent, DEFAULT_POLICY, type LastEventRef } from '../src/index.ts';

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
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 8 * H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: [] });
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
    const d = decideNextEvent({ last: last('IN', start), nowMs: start + 8 * H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: [] });
  });
  it('permanencia larga → SALIDA marcada', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 15 * H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['long_session_out'] });
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
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 - 2 * H, nowMonotonicMs: null, bootId: null, policy });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['clock_regression'] });
  });
});

describe('tiempo mínimo de sesión con confirmación', () => {
  const p = { ...policy, minSessionMinutes: 30 };
  it('salida 3 min después de entrar → pide confirmación, no registra', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 3 * 60_000, nowMonotonicMs: null, bootId: null, policy: p });
    expect(d).toMatchObject({ kind: 'confirm_early_out', minutesSince: 3 });
  });
  it('confirmada → SALIDA con bandera', () => {
    const d = decideNextEvent({ last: last('IN', t0), nowMs: t0 + 3 * 60_000, nowMonotonicMs: null, bootId: null, policy: p, confirmEarlyOut: true });
    expect(d).toMatchObject({ kind: 'record', eventType: 'OUT', flags: ['early_out_confirmed'] });
  });
  it('dentro de la ventana anti-doble sigue siendo duplicado (sin preguntar)', () => {
    expect(decideNextEvent({ last: last('IN', t0), nowMs: t0 + 30_000, nowMonotonicMs: null, bootId: null, policy: p }).kind).toBe('duplicate');
  });
  it('pasado el mínimo → SALIDA directa', () => {
    expect(decideNextEvent({ last: last('IN', t0), nowMs: t0 + 31 * 60_000, nowMonotonicMs: null, bootId: null, policy: p }))
      .toMatchObject({ kind: 'record', eventType: 'OUT', flags: [] });
  });
  it('tras una SALIDA no aplica (entrar de nuevo, p. ej. después de almuerzo, es directo)', () => {
    expect(decideNextEvent({ last: last('OUT', t0), nowMs: t0 + 5 * 60_000, nowMonotonicMs: null, bootId: null, policy: p }))
      .toMatchObject({ kind: 'record', eventType: 'IN' });
  });
});
