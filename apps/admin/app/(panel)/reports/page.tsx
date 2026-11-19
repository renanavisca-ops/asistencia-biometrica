import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { REPORTS, type Report, type ReportType } from '@/lib/reports';

const TYPES: [ReportType, string][] = [['turnover', 'Rotación'], ['punctuality', 'Puntualidad'], ['discipline', 'Disciplina']];

export default async function Reports({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, can, feature } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!feature('reports')) return <p>Este módulo no está habilitado en el plan de su organización.</p>;
  if (!can('report.run')) return <p>Sin permiso para generar reportes.</p>;
  const type = (TYPES.some(([k]) => k === sp.type) ? sp.type : 'punctuality') as ReportType;
  const now = new Date();
  const defFrom = type === 'turnover' ? `${now.getFullYear()}-01-01` : `${now.toISOString().slice(0, 8)}01`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : defFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : now.toISOString().slice(0, 10);
  const { data: stores } = await supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code');
  let rep: Report | null = null, err: string | null = null;
  try { rep = await REPORTS[type](supabase, { org: org.id, from, to, store: sp.store || undefined }); } catch (e) { err = (e as Error).message; }
  const qs = new URLSearchParams({ org: org.id, type, from, to, ...(sp.store ? { store: sp.store } : {}) });
  return (
    <>
      <h2>Reportes</h2>
      <Flash sp={sp} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {TYPES.map(([k, v]) => <Link key={k} className={`tab ${k === type ? 'active' : ''}`} href={`/reports?org=${org.id}&type=${k}&from=${from}&to=${to}`}>{v}</Link>)}
      </div>
      <form className="inline" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="org" value={org.id} /><input type="hidden" name="type" value={type} />
        <label>Desde<input type="date" name="from" defaultValue={from} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={to} /></label>
        {type !== 'turnover' && <label>Sucursal<select name="store" defaultValue={sp.store ?? ''}><option value="">Todas</option>{(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>}
        <button className="secondary">Generar</button>
        <a href={`/api/reports?${qs}&format=xlsx`}><button type="button">Excel</button></a>
        <a href={`/api/reports?${qs}&format=csv`}><button type="button" className="secondary">CSV</button></a>
      </form>
      {err && <div className="msg error">{err}</div>}
      {rep && (
        <>
          <div className="grid">{rep.summary.map(([k, v]) => <div key={k} className="card kpi"><b>{v}</b><span>{k}</span></div>)}</div>
          <table><thead><tr>{rep.header.map((h) => <th key={h}>{h.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>
            {rep.rows.slice(0, 500).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? '—'}</td>)}</tr>)}
            {!rep.rows.length && <tr><td colSpan={rep.header.length} className="muted">Sin datos en el período.</td></tr>}
          </tbody></table>
          {rep.rows.length > 500 && <p className="muted">Se muestran 500 de {rep.rows.length} filas; la exportación incluye todas.</p>}
          <ul className="muted">{rep.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </>
  );
}
