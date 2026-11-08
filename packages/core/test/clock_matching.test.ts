import { describe, expect, it } from 'vitest';
import { assessClock, matchOneToN, l2normalize } from '../src/index.ts';

describe('assessClock', () => {
  const ref = { serverTimeMs: 1_000_000_000, deviceWallMs: 1_000_000_000, monotonicMs: 5_000, bootId: 'a', tzOffsetMin: -360 };
  it('sin referencia de servidor → bandera', () => {
    expect(assessClock({ nowWallMs: 1, nowMonotonicMs: null, bootId: null, tzOffsetMin: 0, ref: null, serverTimeStaleHours: 48 }).flags).toEqual(['no_server_time']);
  });
  it('mismo arranque: usa monotónico y detecta hora retrasada manualmente', () => {
    const a = assessClock({ nowWallMs: ref.deviceWallMs - 3_600_000, nowMonotonicMs: 65_000, bootId: 'a', tzOffsetMin: -360, ref, serverTimeStaleHours: 48 });
    expect(a.bestEstimateMs).toBe(ref.serverTimeMs + 60_000);
    expect(a.flags).toContain('clock_regression');
  });
  it('reinicio desde la última sincronización → bandera', () => {
    const a = assessClock({ nowWallMs: ref.deviceWallMs + 1000, nowMonotonicMs: 10, bootId: 'b', tzOffsetMin: -360, ref, serverTimeStaleHours: 48 });
    expect(a.flags).toContain('reboot_since_server_sync');
  });
  it('cambio de zona horaria y referencia caducada', () => {
    const a = assessClock({ nowWallMs: ref.deviceWallMs + 49 * 3_600_000, nowMonotonicMs: 5_000 + 49 * 3_600_000, bootId: 'a', tzOffsetMin: -300, ref, serverTimeStaleHours: 48 });
    expect(a.flags).toEqual(expect.arrayContaining(['timezone_changed', 'stale_server_time']));
  });
});

describe('matchOneToN', () => {
  const v = (...x: number[]) => l2normalize(Float32Array.from(x));
  const gallery = [
    { employeeId: 'a', templates: [v(1, 0, 0)], modelVersion: 'm@1' },
    { employeeId: 'b', templates: [v(0, 1, 0)], modelVersion: 'm@1' },
  ];
  it('sin calibrar → error, nunca acepta', () => {
    expect(matchOneToN({ probe: v(1, 0, 0), probeModelVersion: 'm@1', gallery, threshold: NaN, minMargin: NaN })).toEqual({ kind: 'error', reason: 'uncalibrated' });
  });
  it('coincidencia clara', () => {
    expect(matchOneToN({ probe: v(0.95, 0.05, 0), probeModelVersion: 'm@1', gallery, threshold: 0.8, minMargin: 0.2 })).toMatchObject({ kind: 'match', employeeId: 'a' });
  });
  it('ambigua entre dos candidatos', () => {
    expect(matchOneToN({ probe: v(1, 1, 0), probeModelVersion: 'm@1', gallery, threshold: 0.5, minMargin: 0.1 }).kind).toBe('ambiguous');
  });
  it('por debajo del umbral', () => {
    expect(matchOneToN({ probe: v(0, 0, 1), probeModelVersion: 'm@1', gallery, threshold: 0.5, minMargin: 0.1 }).kind).toBe('no_match');
  });
  it('rechaza plantillas de otro modelo', () => {
    expect(matchOneToN({ probe: v(1, 0, 0), probeModelVersion: 'm@2', gallery, threshold: 0.5, minMargin: 0.1 })).toEqual({ kind: 'error', reason: 'model_mismatch' });
  });
});
