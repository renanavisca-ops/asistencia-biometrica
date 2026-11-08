import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { orgPolicy, queryEvents, querySessions, workdaysFrom, type SessionRow } from '@/lib/attendance';

const esc = (v: unknown) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v);
  // Evita inyección de fórmulas en Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Exportación CSV (UTF-8 con BOM, compatible con Excel). Usa la sesión del usuario: RLS limita los datos. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const org = p.get('org'), from = p.get('from'), to = p.get('to');
  if (!org || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'parámetros inválidos' }, { status: 400 });
  }
  const f = { org, from, to, store: p.get('store') ?? undefined, employee: p.get('employee') ?? undefined };
  let rows: unknown[][] = [];
  let header: string[];
  const type = p.get('type');
  if (type === 'days') {
    const [{ data, error }, pol] = await Promise.all([querySessions(sb, f, 50000), orgPolicy(sb, org)]);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const loc = (ms: number | null, tz: string) => ms == null ? '' : new Date(ms).toLocaleString('sv-SE', { timeZone: tz });
    header = ['fecha', 'codigo_empleado', 'empleado', 'sede', 'primera_entrada_local', 'ultima_salida_local', 'presente_minutos', 'pausas', 'pausa_minutos', 'en_curso', 'requiere_revision'];
    rows = workdaysFrom((data ?? []) as unknown as SessionRow[], pol).map((d) => [d.date, d.employee.employee_code, `${d.employee.last_name}, ${d.employee.first_name}`,
      d.store.code, loc(d.firstInMs, d.store.timezone), loc(d.lastOutMs, d.store.timezone), d.presentMinutes, d.pauses.length, d.pauseMinutes, d.open, d.needsReview]);
  } else if (type === 'events') {
    const { data, error } = await queryEvents(sb, f, 50000);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    header = ['event_id', 'codigo_empleado', 'empleado', 'sede', 'telefono', 'tipo', 'hora_evento_utc', 'recibido_utc', 'estado', 'motivos_revision', 'origen', 'offline', 'banderas_reloj', 'secuencia'];
    rows = (data ?? []).map((e) => {
      const em = e.employees as unknown as { employee_code: string; first_name: string; last_name: string };
      return [e.id, em.employee_code, `${em.last_name}, ${em.first_name}`, (e.stores as unknown as { code: string }).code,
        (e.devices as unknown as { label: string } | null)?.label, e.event_type, e.occurred_at, e.received_at, e.status, e.review_reasons,
        e.source, e.captured_offline, e.clock_flags, e.device_seq];
    });
  } else {
    const { data, error } = await querySessions(sb, f, 50000);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    header = ['session_id', 'codigo_empleado', 'empleado', 'sede', 'entrada_utc', 'salida_utc', 'permanencia_segundos', 'estado', 'requiere_revision', 'cambio_sede', 'evento_entrada', 'evento_salida'];
    rows = (data ?? []).map((s) => {
      const em = s.employees as unknown as { employee_code: string; first_name: string; last_name: string };
      return [s.id, em.employee_code, `${em.last_name}, ${em.first_name}`, (s.stores as unknown as { code: string }).code, s.opened_at, s.closed_at,
        s.duration_seconds, s.state, s.needs_review, s.cross_store, s.in_event_id, s.out_event_id];
    });
  }
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="asistencia_${type === 'events' ? 'eventos' : type === 'days' ? 'jornadas' : 'sesiones'}_${from}_${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
