import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { REPORTS, type ReportType } from '@/lib/reports';
import { toCsv, toXlsx } from '@/lib/reports-export';

/** Exporta un reporte (CSV o Excel) con la sesión del usuario: RLS y el permiso «report.run» limitan los datos. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const org = p.get('org'), from = p.get('from'), to = p.get('to'), type = p.get('type') as ReportType, format = p.get('format') ?? 'csv';
  if (!org || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !REPORTS[type]) {
    return NextResponse.json({ error: 'parámetros inválidos' }, { status: 400 });
  }
  const { data: allowed } = await sb.rpc('my_org_perm', { p_perm: 'report.run', p_org: org });
  if (allowed !== true) return NextResponse.json({ error: 'permiso denegado' }, { status: 403 });
  let rep;
  try { rep = await REPORTS[type](sb, { org, from, to, store: p.get('store') ?? undefined }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  const base = `${type}_${from}_${to}`;
  if (format === 'xlsx') {
    return new NextResponse(await toXlsx(rep, from, to), { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${base}.xlsx"`, 'cache-control': 'no-store' } });
  }
  return new NextResponse(toCsv(rep), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${base}.csv"`, 'cache-control': 'no-store' } });
}
