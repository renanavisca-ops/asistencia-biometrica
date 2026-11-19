import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { savePlan } from '../actions';

type Plan = { id: string; code: string; name: string; max_employees: number | null; max_stores: number | null; max_devices: number | null;
  features: Record<string, boolean>; price_note: string | null; active: boolean; sort: number };
const FEATURES: [string, string][] = [['hr', 'Expedientes y disciplina'], ['schedules', 'Horarios'], ['alerts', 'Alertas'], ['reports', 'Reportes']];

function PlanForm({ p }: { p?: Plan }) {
  return (
    <form action={savePlan} className="inline">
      {p && <input type="hidden" name="plan_id" value={p.id} />}
      <label>Código<input name="code" required pattern="[a-z0-9_\-]{2,30}" defaultValue={p?.code} style={{ minWidth: 90 }} /></label>
      <label>Nombre<input name="name" required defaultValue={p?.name} /></label>
      <label>Máx. empleados (vacío = sin límite)<input name="max_employees" type="number" min={1} defaultValue={p?.max_employees ?? ''} style={{ minWidth: 90 }} /></label>
      <label>Máx. sucursales<input name="max_stores" type="number" min={1} defaultValue={p?.max_stores ?? ''} style={{ minWidth: 90 }} /></label>
      <label>Máx. teléfonos<input name="max_devices" type="number" min={1} defaultValue={p?.max_devices ?? ''} style={{ minWidth: 90 }} /></label>
      <label>Precio / nota comercial<input name="price_note" defaultValue={p?.price_note ?? ''} /></label>
      <label>Orden<input name="sort" type="number" defaultValue={p?.sort ?? 100} style={{ minWidth: 70 }} /></label>
      <label>Estado<select name="active" defaultValue={p?.active === false ? 'off' : 'on'}><option value="on">Disponible</option><option value="off">Retirado</option></select></label>
      <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 6, display: 'flex', gap: 8 }}><legend className="muted">Módulos</legend>
        {FEATURES.map(([k, v]) => <label key={k} style={{ flexDirection: 'row', gap: 4 }}><input type="checkbox" name={`f_${k}`} defaultChecked={p?.features?.[k] !== false} style={{ minWidth: 0 }} /> {v}</label>)}</fieldset>
      <button className={p ? 'secondary' : undefined}>{p ? 'Guardar' : 'Crear plan'}</button>
    </form>
  );
}

/** Catálogo de planes comerciales. Aplicar un plan copia sus límites a la organización (Organizaciones › Aplicar plan). */
export default async function Plans({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, isSuper } = await getContext();
  if (!isSuper) return <p>Esta área es exclusiva del propietario de la plataforma.</p>;
  const { data } = await supabase.from('platform_plans').select('*').order('sort');
  return (
    <>
      <h2>Planes comerciales</h2>
      <Flash sp={sp} />
      <p className="muted">Los límites se validan en el servidor. Cambiar un plan aquí no modifica las organizaciones que ya lo tienen: vuelva a aplicarlo desde Organizaciones.
        No hay cobro integrado; la nota comercial es informativa.</p>
      {((data ?? []) as Plan[]).map((p) => (
        <details key={p.id} className="card" style={{ marginBottom: 8, opacity: p.active ? 1 : 0.6 }}>
          <summary><b>{p.name}</b> <span className="muted mono">{p.code}</span> — {p.max_employees ?? '∞'} empleados · {p.max_stores ?? '∞'} sucursales · {p.max_devices ?? '∞'} teléfonos
            {p.price_note ? ` · ${p.price_note}` : ''}{!p.active && <span className="badge"> retirado</span>}</summary>
          <div style={{ marginTop: 8 }}><PlanForm p={p} /></div>
        </details>
      ))}
      <div className="card"><h3>Nuevo plan</h3><PlanForm /></div>
    </>
  );
}
