/**
 * Cálculo de los reportes (funciones puras, sin acceso a datos). Las entradas tienen la misma forma que devuelve la API
 * (PostgREST) para las consultas de lib/reports.ts. Método documentado en docs/METODOLOGIA_REPORTES.md.
 */
import { DISC_STATUS, END_TYPE, MEASURE } from './hr';

export type ReportType = 'turnover' | 'punctuality' | 'discipline';
export type ReportFilter = { org: string; from: string; to: string; store?: string };
export type Report = { title: string; header: string[]; rows: (string | number | null)[][]; notes: string[]; summary: [string, string | number][] };

type EmpRef = { first_name: string; last_name: string; employee_code: string } | null;
export type PeriodRow = { employee_id: string; started_on: string; ended_on: string | null; end_type: string | null };
export type FlagRow = { employee_id: string; kind: string; minutes_late: number | null; store_id: string | null; work_date: string; employees: EmpRef; stores: { code: string } | null };
export type RecordRow = { incident_date: string; kind: string; measure: string | null; status: string; employee_informed: boolean;
  employees: EmpRef; hr_catalog: { label: string } | null; stores: { code: string } | null };

export const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const end = to.slice(0, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= end && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const name = (e: EmpRef) => (e ? `${e.last_name}, ${e.first_name}` : '');
const pct = (n: number) => Math.round(n * 10) / 10;

/**
 * Rotación mensual: plantilla inicial = períodos laborales vigentes el primer día del mes; plantilla final = vigentes el
 * último día (una baja con fecha del último día aún cuenta ese día); altas = períodos iniciados en el mes (incluye
 * recontrataciones); bajas = períodos terminados en el mes; rotación % = bajas / ((inicial + final) / 2) × 100.
 */
export function computeTurnover(periods: PeriodRow[], f: ReportFilter): Report {
  const active = (d: string) => periods.filter((p) => p.started_on <= d && (!p.ended_on || p.ended_on >= d)).length;
  let totalExits = 0, sumAvg = 0;
  const rows = monthsBetween(f.from, f.to).map((ym) => {
    const first = `${ym}-01`, last = lastDay(ym);
    const ini = active(first), fin = active(last);
    const hires = periods.filter((p) => p.started_on >= first && p.started_on <= last).length;
    const exits = periods.filter((p) => p.ended_on && p.ended_on >= first && p.ended_on <= last);
    const vol = exits.filter((p) => p.end_type === 'resignation').length;
    const avg = (ini + fin) / 2;
    totalExits += exits.length; sumAvg += avg;
    return [ym, ini, hires, exits.length, vol, exits.length - vol, fin, avg ? pct((exits.length / avg) * 100) : null];
  });
  const n = rows.length || 1;
  const byType = Object.entries(END_TYPE).map(([k, v]) => [v, periods.filter((p) => p.ended_on && p.ended_on >= f.from && p.ended_on <= f.to && p.end_type === k).length] as [string, number]);
  return {
    title: 'Rotación de personal',
    header: ['mes', 'plantilla_inicial', 'altas', 'bajas', 'bajas_voluntarias', 'bajas_otras', 'plantilla_final', 'rotacion_pct'],
    rows,
    summary: [['Bajas en el período', totalExits], ['Rotación del período (%)', sumAvg ? pct((totalExits / (sumAvg / n)) * 100) : '—'], ...byType],
    notes: ['Rotación % = bajas del mes / promedio de plantilla ((inicial + final) / 2) × 100. Voluntarias = renuncias.',
      'Rotación del período = bajas totales / plantilla promedio de los meses × 100.', 'Recontrataciones cuentan como altas (cada período laboral es independiente).',
      'Este reporte es de toda la organización (no se filtra por sucursal).'],
  };
}

/** Puntualidad: jornadas evaluadas con horario de referencia (tardanzas y días sin marcación), agrupadas por empleado. */
export function computePunctuality(flags: FlagRow[]): Report {
  const by = new Map<string, { e: EmpRef; store: string; late: number; mins: number; max: number; noShow: number }>();
  for (const x of flags) {
    const r = by.get(x.employee_id) ?? { e: x.employees, store: x.stores?.code ?? '', late: 0, mins: 0, max: 0, noShow: 0 };
    if (x.kind === 'late') { r.late++; r.mins += x.minutes_late ?? 0; r.max = Math.max(r.max, x.minutes_late ?? 0); } else r.noShow++;
    by.set(x.employee_id, r);
  }
  const rows = [...by.values()].sort((a, b) => b.late - a.late || b.mins - a.mins)
    .map((r) => [r.e?.employee_code ?? '', name(r.e), r.store, r.late, r.mins, r.late ? Math.round(r.mins / r.late) : 0, r.max, r.noShow]);
  const lates = flags.filter((x) => x.kind === 'late').length;
  return {
    title: 'Puntualidad',
    header: ['codigo', 'empleado', 'sucursal', 'llegadas_tarde', 'minutos_tarde_total', 'promedio_minutos', 'maximo_minutos', 'dias_sin_marcacion'],
    rows,
    summary: [['Llegadas tarde', lates], ['Minutos tarde (total)', flags.reduce((a, x) => a + (x.kind === 'late' ? x.minutes_late ?? 0 : 0), 0)],
      ['Días con horario sin marcación', flags.length - lates], ['Empleados con al menos una tardanza', rows.filter((r) => (r[3] as number) > 0).length]],
    notes: ['Solo incluye empleados y días con horario de referencia asignado. Tardanza = primera entrada válida después de la hora programada + tolerancia (una por día).',
      '«Sin marcación» no equivale a ausencia injustificada: requiere revisión (permisos no registrados, olvido de marcar, etc.).',
      'Se usan las marcaciones vigentes (con correcciones aplicadas). Marcaciones offline aún no sincronizadas no están incluidas.'],
  };
}

export function computeDiscipline(recs: RecordRow[]): Report {
  const valid = recs.filter((r) => r.status !== 'voided');
  const cats = new Map<string, number>();
  for (const r of valid.filter((x) => x.kind === 'disciplinary')) {
    const k = r.hr_catalog?.label ?? 'Sin categoría';
    cats.set(k, (cats.get(k) ?? 0) + 1);
  }
  return {
    title: 'Disciplina y reconocimientos',
    header: ['fecha', 'codigo', 'empleado', 'sucursal', 'tipo', 'medida', 'categoria', 'estado', 'informado_al_empleado'],
    rows: recs.map((r) => [r.incident_date, r.employees?.employee_code ?? '', name(r.employees), r.stores?.code ?? '', r.kind === 'recognition' ? 'Reconocimiento' : 'Disciplinario',
      r.measure ? MEASURE[r.measure] ?? r.measure : '', r.hr_catalog?.label ?? '', DISC_STATUS[r.status]?.[0] ?? r.status, r.employee_informed ? 'sí' : 'no']),
    summary: [['Registros disciplinarios', valid.filter((x) => x.kind === 'disciplinary').length], ['Reconocimientos', valid.filter((x) => x.kind === 'recognition').length],
      ['Abiertos (pendiente / en revisión)', valid.filter((x) => ['pending', 'in_review'].includes(x.status)).length], ['Anulados', recs.length - valid.length],
      ...[...cats.entries()].map(([k, v]) => [`Categoría: ${k}`, v] as [string, number])],
    notes: ['Los registros anulados se listan (con estado «Anulado») pero no se cuentan en los totales.'],
  };
}
