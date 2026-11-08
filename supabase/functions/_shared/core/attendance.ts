import type { DecisionFlag, DevicePolicy, EventType, LastEventRef } from './types.ts';

export type Decision =
  | {
      kind: 'record';
      eventType: EventType;
      flags: DecisionFlag[];
      /** Si se debe abrir incidencia de "salida omitida" para la sesión previa (sin inventar el evento de salida). */
      previousSessionMissingOut: boolean;
    }
  | {
      kind: 'confirm_early_out';
      /** Sesión abierta hace menos de minSessionMinutes: la persona debe confirmar que quiere registrar SALIDA. */
      lastEvent: LastEventRef;
      minutesSince: number;
    }
  | {
      kind: 'duplicate';
      /** Evento ya registrado dentro de la ventana anti-doble-marcación. No se altera el estado. */
      lastEvent: LastEventRef;
      secondsSince: number;
    };

export interface DecisionInput {
  last: LastEventRef | null;
  nowMs: number;
  nowMonotonicMs: number | null;
  bootId: string | null;
  policy: Pick<DevicePolicy, 'antiDoubleWindowSec' | 'staleSessionHours' | 'longSessionHours'> & Partial<Pick<DevicePolicy, 'minSessionMinutes'>>;
  /** La persona confirmó en pantalla una salida anticipada. */
  confirmEarlyOut?: boolean;
}

/**
 * Tiempo transcurrido desde el último evento. Si ambos eventos son del mismo arranque se usa el reloj monotónico
 * (inmune a cambios de hora manuales); si no, la hora de pared.
 */
export function elapsedSinceMs(input: DecisionInput): { ms: number; source: 'monotonic' | 'wall' } | null {
  const { last } = input;
  if (!last) return null;
  if (
    last.monotonicMs != null &&
    input.nowMonotonicMs != null &&
    last.bootId != null &&
    last.bootId === input.bootId &&
    input.nowMonotonicMs >= last.monotonicMs
  ) {
    return { ms: input.nowMonotonicMs - last.monotonicMs, source: 'monotonic' };
  }
  return { ms: input.nowMs - last.occurredAtMs, source: 'wall' };
}

/**
 * Determina el siguiente evento de un empleado sin horarios configurados.
 *
 * - Sin sesión abierta → ENTRADA.
 * - Con sesión abierta → SALIDA.
 * - Reconocimiento repetido dentro de la ventana anti-doble → no se registra nada (idempotente).
 * - Con sesión abierta hace menos de minSessionMinutes → se pide confirmación antes de registrar SALIDA.
 * - Sesión abierta más allá de `staleSessionHours` → ENTRADA nueva + incidencia de salida omitida. Se elige así
 *   porque, tras una ausencia larga, es más probable que la persona esté llegando; ambas cosas quedan en revisión.
 *   No se crea ningún evento de salida sintético.
 * - No hay cierre automático a medianoche (turnos nocturnos).
 */
export function decideNextEvent(input: DecisionInput): Decision {
  const { last, policy } = input;
  if (!last) return { kind: 'record', eventType: 'IN', flags: [], previousSessionMissingOut: false };

  const elapsed = elapsedSinceMs(input);
  const ms = elapsed?.ms ?? 0;

  // Reloj que retrocede: no puede usarse para la ventana; se registra y se marca para revisión.
  const regression = ms < 0;
  const flags: DecisionFlag[] = regression ? ['clock_regression'] : [];

  if (!regression && ms < policy.antiDoubleWindowSec * 1000) {
    return { kind: 'duplicate', lastEvent: last, secondsSince: Math.floor(ms / 1000) };
  }

  if (last.eventType === 'OUT') {
    return { kind: 'record', eventType: 'IN', flags, previousSessionMissingOut: false };
  }

  // Sesión abierta.
  const hours = ms / 3_600_000;
  if (!regression && hours >= policy.staleSessionHours) {
    return {
      kind: 'record',
      eventType: 'IN',
      flags: [...flags, 'stale_open_session'],
      previousSessionMissingOut: true,
    };
  }
  const minSession = policy.minSessionMinutes ?? 0;
  if (!regression && ms < minSession * 60_000) {
    if (!input.confirmEarlyOut) return { kind: 'confirm_early_out', lastEvent: last, minutesSince: Math.floor(ms / 60_000) };
    flags.push('early_out_confirmed');
  }
  if (!regression && hours >= policy.longSessionHours) flags.push('long_session_out');
  return { kind: 'record', eventType: 'OUT', flags, previousSessionMissingOut: false };
}
