import type { ClockFlag } from './types.ts';

/** Referencia de hora de servidor guardada en el dispositivo tras cada sincronización. */
export interface ServerTimeRef {
  serverTimeMs: number; // hora del servidor (punto medio corregido por RTT)
  deviceWallMs: number; // hora de pared local al recibirla
  monotonicMs: number | null; // reloj monotónico local al recibirla
  bootId: string | null;
  tzOffsetMin: number;
}

/** Estima la referencia a partir de una ida y vuelta: t0/t1 locales, serverMs devuelto por el servidor. */
export function estimateServerTimeRef(
  t0WallMs: number,
  t1WallMs: number,
  serverMs: number,
  monotonicMs: number | null,
  bootId: string | null,
  tzOffsetMin: number,
): ServerTimeRef & { rttMs: number } {
  const rtt = Math.max(0, t1WallMs - t0WallMs);
  return {
    serverTimeMs: serverMs + rtt / 2,
    deviceWallMs: t1WallMs,
    monotonicMs,
    bootId,
    tzOffsetMin,
    rttMs: rtt,
  };
}

export interface ClockAssessment {
  /** Mejor estimación de la hora real. Con referencia monotónica válida, independiente de la hora de pared. */
  bestEstimateMs: number;
  estOffsetMs: number | null; // bestEstimate - wall
  flags: ClockFlag[];
}

/**
 * Evalúa la hora local. Nunca garantiza hora exacta: durante desconexiones largas solo se puede estimar,
 * y los eventos con banderas se envían a revisión en el servidor.
 */
export function assessClock(params: {
  nowWallMs: number;
  nowMonotonicMs: number | null;
  bootId: string | null;
  tzOffsetMin: number;
  ref: ServerTimeRef | null;
  serverTimeStaleHours: number;
  /** tolerancia entre el avance de pared y el monotónico */
  driftToleranceMs?: number;
}): ClockAssessment {
  const tol = params.driftToleranceMs ?? 120_000;
  const flags: ClockFlag[] = [];
  const { ref } = params;
  if (!ref) return { bestEstimateMs: params.nowWallMs, estOffsetMs: null, flags: ['no_server_time'] };

  if (ref.tzOffsetMin !== params.tzOffsetMin) flags.push('timezone_changed');

  const sameBoot =
    ref.monotonicMs != null && params.nowMonotonicMs != null && ref.bootId != null && ref.bootId === params.bootId;

  let best: number;
  if (sameBoot) {
    const monoElapsed = params.nowMonotonicMs! - ref.monotonicMs!;
    best = ref.serverTimeMs + monoElapsed;
    const wallElapsed = params.nowWallMs - ref.deviceWallMs;
    if (wallElapsed < monoElapsed - tol) flags.push('clock_regression');
    else if (wallElapsed > monoElapsed + tol) flags.push('clock_jump_forward');
  } else {
    flags.push('reboot_since_server_sync');
    best = params.nowWallMs + (ref.serverTimeMs - ref.deviceWallMs);
    if (params.nowWallMs < ref.deviceWallMs) flags.push('clock_regression');
  }

  if (best - ref.serverTimeMs > params.serverTimeStaleHours * 3_600_000) flags.push('stale_server_time');
  return { bestEstimateMs: best, estOffsetMs: best - params.nowWallMs, flags };
}
