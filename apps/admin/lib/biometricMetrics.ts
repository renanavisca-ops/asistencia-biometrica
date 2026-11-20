/**
 * Métricas de validación biométrica a partir de los intentos del modo validación (tabla biometric_trials).
 * Metodología (docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md):
 *  - Personas enroladas («genuine»): FRR del sistema = intentos que NO terminan reconociendo a la persona correcta / total
 *    (incluye rechazos por prueba de vida, no reconocido, dudoso y tiempo agotado). Identificación errónea = reconoció a OTRA persona.
 *  - Personas no enroladas («impostor»): FAR = intentos que terminaron reconociendo a alguien / total.
 *  - Ataques (foto impresa, pantalla, vídeo, otro): APCER = presentaciones de ataque que la prueba de vida NO detuvo /
 *    ataques evaluados (se excluyen los que terminaron por tiempo antes de evaluar la prueba de vida, que se informan aparte).
 *    «Lograron marcar» = ataques que terminaron reconociendo a un empleado (lo más grave en la práctica).
 *  - BPCER = intentos de personas reales (enroladas y no enroladas) rechazados por la prueba de vida / intentos reales evaluados.
 *  - Intervalos de confianza de Wilson al 95 %. Con muestras pequeñas el intervalo es ancho: no se publica un porcentaje sin su n.
 */
export type TrialRow = {
  condition: string; outcome: string; outcome_reason: string | null; expected_employee_id: string | null; identified_employee_id: string | null;
  top1_employee_id: string | null; top1_score: number | null; top2_score: number | null; passive_score: number | null;
  challenge_mode: string | null; challenge_passed: boolean | null; total_ms: number | null; timings: Record<string, unknown> | null;
  device_info: Record<string, unknown> | null; lighting: string | null; captured_at: string;
};
export type Rate = { k: number; n: number; rate: number | null; lo: number | null; hi: number | null };

export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n === 0) return { k, n, rate: null, lo: null, hi: null };
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { k, n, rate: p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
export const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
const ATTACKS = ['attack_print', 'attack_screen', 'attack_video', 'attack_other'] as const;
const isPadTimeout = (r: TrialRow) => r.outcome === 'timeout'; // terminó antes de evaluar la prueba de vida
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function computeMetrics(rows: TrialRow[]) {
  const genuine = rows.filter((r) => r.condition === 'genuine');
  const impostor = rows.filter((r) => r.condition === 'impostor');
  const correct = genuine.filter((r) => r.outcome === 'identified' && r.identified_employee_id === r.expected_employee_id);
  const misId = genuine.filter((r) => r.outcome === 'identified' && r.identified_employee_id !== r.expected_employee_id);
  const reasons = (list: TrialRow[]) => {
    const m = new Map<string, number>();
    for (const r of list) { const k = r.outcome === 'liveness_failed' ? `liveness_failed:${r.outcome_reason ?? ''}` : r.outcome; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const bonaFide = [...genuine, ...impostor].filter((r) => !isPadTimeout(r));
  const attacks = ATTACKS.map((type) => {
    const all = rows.filter((r) => r.condition === type);
    const evaluated = all.filter((r) => !isPadTimeout(r));
    const notStopped = evaluated.filter((r) => r.outcome !== 'liveness_failed');
    return { type, total: all.length, timeouts: all.length - evaluated.length, apcer: wilson(notStopped.length, evaluated.length),
      punched: wilson(all.filter((r) => r.outcome === 'identified').length, all.length) };
  });
  const allAttacks = rows.filter((r) => (ATTACKS as readonly string[]).includes(r.condition));
  const ok = correct.map((r) => r.total_ms).filter((x): x is number => x != null);
  const avgOf = (k: string) => { const v = rows.map((r) => num(r.timings?.[k])).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const mem = rows.map((r) => num(r.device_info?.memoryMb)).filter((x): x is number => x != null);
  return {
    genuine: { n: genuine.length, frr: wilson(genuine.length - correct.length, genuine.length), misidentified: wilson(misId.length, genuine.length), reasons: reasons(genuine.filter((r) => !correct.includes(r))) },
    impostor: { n: impostor.length, far: wilson(impostor.filter((r) => r.outcome === 'identified').length, impostor.length), reasons: reasons(impostor) },
    bpcer: wilson(bonaFide.filter((r) => r.outcome === 'liveness_failed').length, bonaFide.length),
    attacks, attacksTotal: { apcer: wilson(allAttacks.filter((r) => !isPadTimeout(r) && r.outcome !== 'liveness_failed').length, allAttacks.filter((r) => !isPadTimeout(r)).length),
      punched: wilson(allAttacks.filter((r) => r.outcome === 'identified').length, allAttacks.length) },
    latency: { n: ok.length, p50: quantile(ok, 0.5), p95: quantile(ok, 0.95), detectMs: avgOf('detectMs'), embedMs: avgOf('embedMs'), padMs: avgOf('padMs'), challengeMs: avgOf('challengeMs') },
    memoryMb: mem.length ? { min: Math.min(...mem), max: Math.max(...mem) } : null,
  };
}

/**
 * Barrido de umbrales SOLO del reconocimiento (independiente de la prueba de vida): puntuación del mejor candidato.
 * Genuinas = intentos de personas enroladas cuyo mejor candidato es la persona correcta; impostoras = mejor candidato de
 * personas no enroladas (y de enroladas cuando el mejor candidato es otra persona).
 */
export function thresholdSweep(rows: TrialRow[], thresholds = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) {
  const gen = rows.filter((r) => r.condition === 'genuine' && r.top1_score != null && r.top1_employee_id === r.expected_employee_id).map((r) => r.top1_score!);
  const imp = rows.filter((r) => r.top1_score != null && (r.condition === 'impostor' || (r.condition === 'genuine' && r.top1_employee_id !== r.expected_employee_id)))
    .map((r) => r.top1_score!);
  return { genuineN: gen.length, impostorN: imp.length,
    rows: thresholds.map((t) => ({ t, fnmr: wilson(gen.filter((s) => s < t).length, gen.length), fmr: wilson(imp.filter((s) => s >= t).length, imp.length) })) };
}

/** Barrido del umbral de la prueba de vida pasiva: personas reales vs ataques. */
export function padSweep(rows: TrialRow[], thresholds = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
  const real = rows.filter((r) => (r.condition === 'genuine' || r.condition === 'impostor') && r.passive_score != null).map((r) => r.passive_score!);
  const att = rows.filter((r) => (ATTACKS as readonly string[]).includes(r.condition) && r.passive_score != null).map((r) => r.passive_score!);
  return { realN: real.length, attackN: att.length,
    rows: thresholds.map((t) => ({ t, bpcer: wilson(real.filter((s) => s < t).length, real.length), apcer: wilson(att.filter((s) => s >= t).length, att.length) })) };
}
