import { describe, expect, it } from 'vitest';
import { computeMetrics, padSweep, thresholdSweep, wilson, type TrialRow } from '../lib/biometricMetrics';

const row = (o: Partial<TrialRow>): TrialRow => ({ condition: 'genuine', outcome: 'identified', outcome_reason: null, expected_employee_id: 'A',
  identified_employee_id: 'A', top1_employee_id: 'A', top1_score: 0.7, top2_score: 0.2, passive_score: 0.95, challenge_mode: 'blink', challenge_passed: true,
  total_ms: 2000, timings: { detectMs: 100, embedMs: 50, padMs: 40 }, device_info: { memoryMb: 200 }, lighting: 'normal', captured_at: '2026-11-20T00:00:00Z', ...o });

describe('métricas de validación biométrica', () => {
  it('intervalo de Wilson (valores de referencia)', () => {
    const w = wilson(0, 10);
    expect(w.rate).toBe(0); expect(w.lo).toBe(0); expect(w.hi!).toBeCloseTo(0.2775, 3); // «0 de 10» no es 0 %: hasta 27,8 %
    const h = wilson(5, 10); expect(h.lo!).toBeCloseTo(0.2366, 3); expect(h.hi!).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0).rate).toBeNull();
  });

  it('FRR, identificación errónea, FAR, APCER, BPCER y «lograron marcar»', () => {
    const rows: TrialRow[] = [
      row({}), row({}), row({}),                                                                    // 3 aciertos
      row({ outcome: 'liveness_failed', outcome_reason: 'challenge_timeout', identified_employee_id: null }), // rechazo por prueba de vida
      row({ outcome: 'not_recognized', identified_employee_id: null, top1_score: 0.35 }),            // no reconocido
      row({ identified_employee_id: 'B', top1_employee_id: 'B' }),                                   // identificó a otra persona
      row({ condition: 'impostor', expected_employee_id: null, outcome: 'not_recognized', identified_employee_id: null, top1_score: 0.25 }),
      row({ condition: 'impostor', expected_employee_id: null, outcome: 'identified', identified_employee_id: 'A', top1_score: 0.45 }), // falsa aceptación
      row({ condition: 'attack_print', expected_employee_id: null, outcome: 'liveness_failed', identified_employee_id: null, passive_score: 0.3 }),
      row({ condition: 'attack_print', expected_employee_id: null, outcome: 'timeout', identified_employee_id: null, passive_score: null }),
      row({ condition: 'attack_video', expected_employee_id: null, outcome: 'identified', identified_employee_id: 'A', passive_score: 0.9 }),
    ];
    const m = computeMetrics(rows);
    expect(m.genuine.n).toBe(6);
    expect(m.genuine.frr).toMatchObject({ k: 3, n: 6 });
    expect(m.genuine.misidentified).toMatchObject({ k: 1, n: 6 });
    expect(m.impostor.far).toMatchObject({ k: 1, n: 2 });
    expect(m.bpcer).toMatchObject({ k: 1, n: 8 });                         // 1 persona real rechazada por la prueba de vida de 8
    const print = m.attacks.find((a) => a.type === 'attack_print')!;
    expect(print).toMatchObject({ total: 2, timeouts: 1 });
    expect(print.apcer).toMatchObject({ k: 0, n: 1 });                     // el que terminó por tiempo no cuenta como evaluado
    const video = m.attacks.find((a) => a.type === 'attack_video')!;
    expect(video.apcer).toMatchObject({ k: 1, n: 1 }); expect(video.punched).toMatchObject({ k: 1, n: 1 });
    expect(m.attacksTotal.punched).toMatchObject({ k: 1, n: 3 });
    expect(m.latency.n).toBe(3); expect(m.latency.p50).toBe(2000);
  });

  it('barridos de umbral', () => {
    const rows = [row({ top1_score: 0.62 }), row({ top1_score: 0.48 }), row({ condition: 'impostor', expected_employee_id: null, top1_score: 0.41, top1_employee_id: 'A' }),
      row({ condition: 'attack_screen', passive_score: 0.85 }), row({ passive_score: 0.97 })];
    const s = thresholdSweep(rows);
    expect(s.genuineN).toBe(3); expect(s.impostorN).toBe(1); // dos genuinas de 0,62/0,48 + la de 0,7 por defecto
    expect(s.rows.find((r) => r.t === 0.5)!.fnmr).toMatchObject({ k: 1, n: 3 });
    expect(s.rows.find((r) => r.t === 0.4)!.fmr).toMatchObject({ k: 1, n: 1 });
    expect(s.rows.find((r) => r.t === 0.45)!.fmr).toMatchObject({ k: 0, n: 1 });
    const p = padSweep(rows);
    expect(p.rows.find((r) => r.t === 0.8)!.apcer).toMatchObject({ k: 1, n: 1 });
    expect(p.rows.find((r) => r.t === 0.9)!.apcer).toMatchObject({ k: 0, n: 1 });
  });
});
