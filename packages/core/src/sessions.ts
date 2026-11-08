import type { EventType } from './types.ts';

export interface ProjectableEvent {
  id: string;
  employeeId: string;
  storeId: string;
  eventType: EventType;
  occurredAtMs: number;
}

export type SessionState = 'open' | 'closed' | 'missing_out' | 'orphan_out';

export interface ProjectedSession {
  employeeId: string;
  storeId: string;
  inEventId: string | null;
  outEventId: string | null;
  openedAtMs: number | null;
  closedAtMs: number | null;
  /** Permanencia entre marcaciones. NO equivale necesariamente a horas efectivamente trabajadas. */
  durationMs: number | null;
  state: SessionState;
  crossStore: boolean;
}

/**
 * Proyección de sesiones a partir de eventos válidos ordenados. Debe producir el mismo resultado que la función SQL
 * `private.rebuild_sessions` (ver supabase/migrations). Nunca crea eventos: solo empareja y marca anomalías.
 */
export function projectSessions(events: ProjectableEvent[]): ProjectedSession[] {
  const sorted = [...events].sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.id.localeCompare(b.id));
  const out: ProjectedSession[] = [];
  let open: ProjectableEvent | null = null;
  for (const e of sorted) {
    if (e.eventType === 'IN') {
      if (open) out.push(session(open, null, 'missing_out'));
      open = e;
    } else if (open) {
      out.push(session(open, e, 'closed'));
      open = null;
    } else {
      out.push(session(null, e, 'orphan_out'));
    }
  }
  if (open) out.push(session(open, null, 'open'));
  return out;
}

function session(inE: ProjectableEvent | null, outE: ProjectableEvent | null, state: SessionState): ProjectedSession {
  const ref = (inE ?? outE)!;
  return {
    employeeId: ref.employeeId,
    storeId: (inE ?? outE)!.storeId,
    inEventId: inE?.id ?? null,
    outEventId: outE?.id ?? null,
    openedAtMs: inE?.occurredAtMs ?? null,
    closedAtMs: outE?.occurredAtMs ?? null,
    durationMs: inE && outE ? outE.occurredAtMs - inE.occurredAtMs : null,
    state,
    crossStore: !!(inE && outE && inE.storeId !== outE.storeId),
  };
}
