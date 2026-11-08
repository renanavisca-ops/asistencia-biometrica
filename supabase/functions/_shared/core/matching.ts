/**
 * Comparación 1:N de embeddings faciales contra la galería autorizada de la tienda.
 *
 * IMPORTANTE: este módulo NO es biometría por sí mismo. Solo compara vectores producidos por un modelo de
 * reconocimiento real (ver docs/BIOMETRICS.md). Los umbrales dependen del modelo y deben calibrarse con datos
 * propios; por eso no hay valores por defecto utilizables.
 */
export interface GalleryEntry {
  employeeId: string;
  /** Uno o varios embeddings L2-normalizados del enrolamiento. */
  templates: Float32Array[];
  modelVersion: string;
}

export type MatchResult =
  | { kind: 'match'; employeeId: string; score: number; margin: number }
  | { kind: 'no_match'; bestScore: number | null }
  | { kind: 'ambiguous'; bestScore: number; margin: number }
  | { kind: 'error'; reason: 'uncalibrated' | 'model_mismatch' | 'empty_gallery' | 'dimension_mismatch' };

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function matchOneToN(params: {
  probe: Float32Array; // L2-normalizado
  probeModelVersion: string;
  gallery: GalleryEntry[];
  threshold: number;
  minMargin: number;
}): MatchResult {
  const { probe, gallery, threshold, minMargin } = params;
  if (!Number.isFinite(threshold) || !Number.isFinite(minMargin)) return { kind: 'error', reason: 'uncalibrated' };
  if (gallery.length === 0) return { kind: 'error', reason: 'empty_gallery' };

  const perEmployee: { id: string; score: number }[] = [];
  for (const g of gallery) {
    if (g.modelVersion !== params.probeModelVersion) return { kind: 'error', reason: 'model_mismatch' };
    let best = -Infinity;
    for (const t of g.templates) {
      if (t.length !== probe.length) return { kind: 'error', reason: 'dimension_mismatch' };
      best = Math.max(best, cosine(probe, t));
    }
    if (best > -Infinity) perEmployee.push({ id: g.employeeId, score: best });
  }
  perEmployee.sort((a, b) => b.score - a.score);
  const top = perEmployee[0];
  if (!top) return { kind: 'no_match', bestScore: null };
  const second = perEmployee[1]?.score ?? -1;
  const margin = top.score - second;
  if (top.score < threshold) return { kind: 'no_match', bestScore: top.score };
  if (margin < minMargin) return { kind: 'ambiguous', bestScore: top.score, margin };
  return { kind: 'match', employeeId: top.id, score: top.score, margin };
}
