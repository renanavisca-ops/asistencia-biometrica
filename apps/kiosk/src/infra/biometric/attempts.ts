/**
 * Registro local de intentos biométricos fallidos (no reconocido, prueba de vida fallida, etc.).
 * Se envía como banderas en el informe de salud de cada sincronización ("pad_fail:3") para alertas en el panel,
 * y aplica un enfriamiento tras N fallos consecutivos (política maxFailedAttempts / cooldownSec).
 */
const counts: Record<string, number> = {};
/** Detalle de los últimos intentos (puntuaciones, sin imágenes ni plantillas) para calibrar desde el servidor. */
const recent: string[] = [];
const note = (s: string) => { recent.push(s.slice(0, 60)); if (recent.length > 12) recent.shift(); };
let consecutive = 0;
let cooldownUntil = 0;

export function recordFailure(kind: string, maxConsecutive: number, cooldownSec: number, detail = '') {
  counts[kind] = (counts[kind] ?? 0) + 1;
  note(`bio_fail:${kind}${detail ? ':' + detail : ''}`);
  consecutive++;
  if (consecutive >= maxConsecutive) { cooldownUntil = Date.now() + cooldownSec * 1000; consecutive = 0; counts.cooldown = (counts.cooldown ?? 0) + 1; }
}
export function recordSuccess(detail = '') { consecutive = 0; if (detail) note(`bio_ok:${detail}`); }
export function cooldownRemainingSec() { return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)); }
/** Banderas para el informe de salud; se reinician tras leerlas. */
export function takeHealthFlags(): string[] {
  const f = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`);
  for (const k of Object.keys(counts)) counts[k] = 0;
  const out = [...f, ...recent].slice(-20);
  recent.length = 0;
  return out;
}
