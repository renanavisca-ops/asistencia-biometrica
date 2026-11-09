/**
 * Resumen por jornada a partir de sesiones (pares entrada/salida).
 * Desde la app 0.5 la persona elige al salir «almuerzo/pausa» (la jornada continúa) o «fin de turno» (termina).
 * Para salidas antiguas sin elección se DEDUCE: una salida seguida de entrada dentro de pauseMaxMinutes es pausa.
 * La jornada se fecha por su primera entrada en la zona horaria de la sede (los turnos nocturnos no se cortan a medianoche).
 * No calcula tardanzas ni horas extra (no hay horarios); "presente" es tiempo entre marcaciones, no horas trabajadas.
 */
export interface SessionLike {
  employeeId: string;
  openedAtMs: number | null;
  closedAtMs: number | null;
  state: 'open' | 'closed' | 'missing_out' | 'orphan_out';
  needsReview: boolean;
  /** Tipo de la salida que cierra la sesión (null = sin elección: se deduce por el tiempo). */
  outKind?: 'break' | 'end' | null;
}

/** 'almuerzo' = salida elegida como almuerzo/pausa; 'pausa'/'breve' = deducidas por el tiempo (salidas antiguas). */
export interface Pause { fromMs: number; toMs: number; minutes: number; kind: 'almuerzo' | 'pausa' | 'breve' }

/** Máximo de horas que una salida a almuerzo mantiene abierta la jornada (después, el regreso inicia otra jornada). */
export const MAX_BREAK_HOURS = 6;

export interface Workday {
  employeeId: string;
  date: string; // YYYY-MM-DD en la zona de la sede
  firstInMs: number | null;
  lastOutMs: number | null;
  presentMinutes: number; // suma de sesiones cerradas
  pauses: Pause[];
  pauseMinutes: number;
  sessions: number;
  open: boolean; // la jornada termina con una sesión abierta
  onBreak: boolean; // la jornada termina con una salida a almuerzo sin regreso (aún)
  openSinceMs: number | null; // entrada de la sesión abierta (para el tiempo en curso)
  needsReview: boolean; // contiene sesiones anómalas (salida omitida, sin entrada, en revisión)
}

export function localDate(ms: number, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function summarizeWorkdays(sessions: SessionLike[], opts: { timeZone: string; pauseMinMinutes: number; pauseMaxMinutes: number }): Workday[] {
  const byEmp = new Map<string, SessionLike[]>();
  for (const s of sessions) (byEmp.get(s.employeeId) ?? byEmp.set(s.employeeId, []).get(s.employeeId)!).push(s);
  const out: Workday[] = [];
  for (const [employeeId, list] of byEmp) {
    const sorted = [...list].sort((a, b) => (a.openedAtMs ?? a.closedAtMs ?? 0) - (b.openedAtMs ?? b.closedAtMs ?? 0));
    let cur: Workday | null = null;
    let prevClose: number | null = null;
    let prevKind: 'break' | 'end' | null = null;
    for (const s of sorted) {
      const start = s.openedAtMs ?? s.closedAtMs!;
      const gapMin = prevClose != null && s.openedAtMs != null ? (s.openedAtMs - prevClose) / 60_000 : null;
      const withinGap = gapMin != null && gapMin >= 0 && (prevKind === 'break' ? gapMin <= MAX_BREAK_HOURS * 60 : gapMin <= opts.pauseMaxMinutes);
      const continues = cur && !cur.open && prevKind !== 'end' && withinGap;
      if (!continues) {
        if (cur) out.push(cur);
        cur = { employeeId, date: localDate(start, opts.timeZone), firstInMs: s.openedAtMs, lastOutMs: null, presentMinutes: 0,
          pauses: [], pauseMinutes: 0, sessions: 0, open: false, onBreak: false, openSinceMs: null, needsReview: false };
      } else if (gapMin != null && prevClose != null) {
        const m = Math.round(gapMin);
        cur!.pauses.push({ fromMs: prevClose, toMs: s.openedAtMs!, minutes: m,
          kind: prevKind === 'break' ? 'almuerzo' : gapMin >= opts.pauseMinMinutes ? 'pausa' : 'breve' });
        cur!.pauseMinutes += m;
        cur!.onBreak = false;
      }
      const w = cur!;
      w.sessions++;
      if (s.state === 'closed' && s.openedAtMs != null && s.closedAtMs != null) {
        w.presentMinutes += Math.round((s.closedAtMs - s.openedAtMs) / 60_000);
        w.lastOutMs = s.closedAtMs;
      }
      if (s.state === 'open') { w.open = true; w.openSinceMs = s.openedAtMs; }
      if (s.state !== 'closed' && s.state !== 'open') w.needsReview = true;
      if (s.needsReview) w.needsReview = true;
      prevClose = s.state === 'closed' ? s.closedAtMs : null;
      prevKind = s.state === 'closed' ? (s.outKind ?? null) : null;
      w.onBreak = s.state === 'closed' && s.outKind === 'break';
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.employeeId.localeCompare(b.employeeId));
}

export interface PunchLike { eventType: 'IN' | 'OUT'; occurredAtMs: number; outKind: 'break' | 'end' | null }

/**
 * Resumen del turno en curso para el mensaje de salida en el teléfono («Turno laborado 8 h, almuerzo 1 h»).
 * Recorre hacia atrás las marcaciones conocidas por el teléfono hasta el inicio de la jornada (una salida de fin
 * de turno, o una salida antigua seguida de más de pauseMaxMinutes). `complete` = se conoce la primera entrada.
 */
export function shiftSummary(events: PunchLike[], opts: { pauseMaxMinutes: number }) {
  const ev = [...events].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  let start = 0;
  for (let i = ev.length - 1; i > 0; i--) {
    const cur = ev[i]!, prev = ev[i - 1]!;
    if (cur.eventType !== 'IN' || prev.eventType !== 'OUT') continue;
    const gapMin = (cur.occurredAtMs - prev.occurredAtMs) / 60_000;
    const sameDay = prev.outKind === 'break' ? gapMin <= MAX_BREAK_HOURS * 60 : prev.outKind === null && gapMin <= opts.pauseMaxMinutes;
    if (!sameDay) { start = i; break; }
  }
  let worked = 0, breaks = 0, openIn: number | null = null, lastOut: number | null = null;
  for (const e of ev.slice(start)) {
    if (e.eventType === 'IN') { if (lastOut != null && openIn == null) breaks += e.occurredAtMs - lastOut; openIn = e.occurredAtMs; }
    else if (openIn != null) { worked += e.occurredAtMs - openIn; openIn = null; lastOut = e.occurredAtMs; }
  }
  const first = ev.slice(start).find((e) => e.eventType === 'IN');
  return { workedMinutes: Math.round(worked / 60_000), breakMinutes: Math.round(breaks / 60_000), startMs: first?.occurredAtMs ?? null,
    complete: start > 0 || ev[0]?.eventType === 'IN' };
}
