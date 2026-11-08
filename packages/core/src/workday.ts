/**
 * Resumen por jornada a partir de sesiones (pares entrada/salida). Las pausas (almuerzo, etc.) se DEDUCEN:
 * el empleado solo marca; una salida seguida de entrada dentro de pauseMaxMinutes pertenece a la misma jornada.
 * La jornada se fecha por su primera entrada en la zona horaria de la sede (los turnos nocturnos no se cortan a medianoche).
 * No calcula tardanzas ni horas extra (no hay horarios); "presente" es tiempo entre marcaciones, no horas trabajadas.
 */
export interface SessionLike {
  employeeId: string;
  openedAtMs: number | null;
  closedAtMs: number | null;
  state: 'open' | 'closed' | 'missing_out' | 'orphan_out';
  needsReview: boolean;
}

export interface Pause { fromMs: number; toMs: number; minutes: number; kind: 'pausa' | 'breve' }

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
    for (const s of sorted) {
      const start = s.openedAtMs ?? s.closedAtMs!;
      const gapMin = prevClose != null && s.openedAtMs != null ? (s.openedAtMs - prevClose) / 60_000 : null;
      const continues = cur && !cur.open && gapMin != null && gapMin >= 0 && gapMin <= opts.pauseMaxMinutes;
      if (!continues) {
        if (cur) out.push(cur);
        cur = { employeeId, date: localDate(start, opts.timeZone), firstInMs: s.openedAtMs, lastOutMs: null, presentMinutes: 0,
          pauses: [], pauseMinutes: 0, sessions: 0, open: false, needsReview: false };
      } else if (gapMin != null && prevClose != null) {
        const m = Math.round(gapMin);
        cur!.pauses.push({ fromMs: prevClose, toMs: s.openedAtMs!, minutes: m, kind: gapMin >= opts.pauseMinMinutes ? 'pausa' : 'breve' });
        cur!.pauseMinutes += m;
      }
      const w = cur!;
      w.sessions++;
      if (s.state === 'closed' && s.openedAtMs != null && s.closedAtMs != null) {
        w.presentMinutes += Math.round((s.closedAtMs - s.openedAtMs) / 60_000);
        w.lastOutMs = s.closedAtMs;
      }
      if (s.state === 'open') w.open = true;
      if (s.state !== 'closed' && s.state !== 'open') w.needsReview = true;
      if (s.needsReview) w.needsReview = true;
      prevClose = s.state === 'closed' ? s.closedAtMs : null;
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.employeeId.localeCompare(b.employeeId));
}
