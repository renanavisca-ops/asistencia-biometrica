import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { buildTemplate, mondayOf, type WeeklyEmployee } from '@/lib/weekly';

type Cell = { employee_code: string; first_name: string; last_name: string; weekday: number; start_time: string | null; end_time: string | null; kind: string };

/** Plantilla Excel del horario semanal de una sucursal, con sus empleados y el horario vigente de esa semana. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const store = p.get('store'), week = p.get('week');
  if (!store || !week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: 'parámetros inválidos' }, { status: 400 });
  const monday = mondayOf(week);
  const [{ data: st }, { data, error }] = await Promise.all([
    sb.from('stores').select('code, name').eq('id', store).maybeSingle(),
    sb.rpc('store_week_schedule', { p_store: store, p_week_start: monday }),
  ]);
  if (error || !st) return NextResponse.json({ error: error?.message ?? 'sucursal no encontrada' }, { status: 403 });
  const by = new Map<string, WeeklyEmployee>();
  for (const c of (data ?? []) as Cell[]) {
    const e = by.get(c.employee_code) ?? { code: c.employee_code, name: `${c.last_name}, ${c.first_name}`, days: {} };
    if (c.kind === 'scheduled' && c.start_time) e.days[c.weekday] = { start: c.start_time.slice(0, 5), end: c.end_time?.slice(0, 5) ?? null };
    by.set(c.employee_code, e);
  }
  const buf = await buildTemplate({ storeCode: st.code, storeName: st.name, weekStart: monday, tolerance: Number(p.get('tolerance') ?? 5) || 5, employees: [...by.values()] });
  return new NextResponse(buf, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="horario_${st.code}_${monday}.xlsx"`, 'cache-control': 'no-store' } });
}
