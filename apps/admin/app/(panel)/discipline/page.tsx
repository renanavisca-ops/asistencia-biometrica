import Link from 'next/link';
import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { DISC_STATUS, MEASURE, fmtDate } from '@/lib/hr';

type Emp = { first_name: string; last_name: string; employee_code: string };

/** Registro de medidas disciplinarias y reconocimientos de la organización (los detalles y el seguimiento están en cada expediente). */
export default async function Discipline({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, can, feature } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!feature('hr')) return <p>Este módulo no está habilitado en el plan de su organización.</p>;
  if (!can('hr.read')) return <p>Sin permiso para ver expedientes.</p>;
  let q = supabase.from('disciplinary_records').select('id, employee_id, kind, incident_date, measure, status, description, employees(first_name, last_name, employee_code), hr_catalog(label), stores(code)')
    .eq('organization_id', org.id).order('incident_date', { ascending: false }).limit(500);
  if (sp.status === 'open') q = q.in('status', ['pending', 'in_review']); else if (sp.status) q = q.eq('status', sp.status);
  if (sp.kind) q = q.eq('kind', sp.kind);
  if (sp.category) q = q.eq('category_id', sp.category);
  if (sp.store) q = q.eq('store_id', sp.store);
  if (sp.from) q = q.gte('incident_date', sp.from);
  if (sp.to) q = q.lte('incident_date', sp.to);
  const [{ data }, { data: cats }, { data: stores }] = await Promise.all([
    q, supabase.from('hr_catalog').select('id, label').eq('organization_id', org.id).eq('kind', 'discipline_category').order('sort'),
    supabase.from('stores').select('id, code, name').eq('organization_id', org.id).order('code'),
  ]);
  return (
    <>
      <h2>Disciplina y reconocimientos</h2>
      <Flash sp={sp} />
      <p className="muted">Para registrar una medida o dar seguimiento, abra el expediente del empleado. Esta información nunca se muestra en los teléfonos de las tiendas.</p>
      <form className="inline" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="org" value={org.id} />
        <label>Estado<select name="status" defaultValue={sp.status ?? ''}><option value="">Todos</option><option value="open">Abiertos (pendiente / en revisión)</option>
          {Object.entries(DISC_STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Tipo<select name="kind" defaultValue={sp.kind ?? ''}><option value="">Todos</option><option value="disciplinary">Disciplinario</option><option value="recognition">Reconocimiento</option></select></label>
        <label>Categoría<select name="category" defaultValue={sp.category ?? ''}><option value="">Todas</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Sucursal<select name="store" defaultValue={sp.store ?? ''}><option value="">Todas</option>{(stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label>Desde<input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
        <button className="secondary">Filtrar</button>
      </form>
      <table><thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo / medida</th><th>Categoría</th><th>Sucursal</th><th>Estado</th></tr></thead><tbody>
        {(data ?? []).map((r) => {
          const em = r.employees as unknown as Emp;
          return (
            <tr key={r.id}><td>{fmtDate(r.incident_date)}</td>
              <td><Link href={`/employees/${r.employee_id}?org=${org.id}`}>{em.last_name}, {em.first_name}</Link> <span className="muted mono">#{em.employee_code}</span></td>
              <td>{r.kind === 'recognition' ? 'Reconocimiento' : MEASURE[r.measure ?? '']}</td><td>{(r.hr_catalog as unknown as { label: string } | null)?.label ?? '—'}</td>
              <td>{(r.stores as unknown as { code: string } | null)?.code ?? '—'}</td>
              <td><span className={`badge ${DISC_STATUS[r.status]?.[1]}`}>{DISC_STATUS[r.status]?.[0]}</span></td></tr>
          );
        })}
        {!data?.length && <tr><td colSpan={6} className="muted">Sin registros con estos filtros.</td></tr>}
      </tbody></table>
    </>
  );
}
