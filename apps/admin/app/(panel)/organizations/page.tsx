import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { createRegion, createStore, setPrefix, setStoreStatus } from './actions';

// Zonas horarias de Centroamérica (IANA). Se pueden escribir otras manualmente.
const TZ = ['America/Guatemala', 'America/El_Salvador', 'America/Tegucigalpa', 'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Belize'];

export default async function Organizations({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide } = await getContext(sp.org);
  const { data: orgRow } = org
    ? await supabase.from('organizations').select('employee_code_prefix, next_employee_number').eq('id', org.id).maybeSingle()
    : { data: null };
  const [{ data: regions }, { data: stores }] = org
    ? await Promise.all([
        supabase.from('regions').select('*').eq('organization_id', org.id).order('country_code'),
        supabase.from('stores').select('*, regions(name, country_code)').eq('organization_id', org.id).order('code'),
      ])
    : [{ data: [] }, { data: [] }];
  const canManage = org ? orgWide('store.manage') : false;
  return (
    <>
      <h2>Sucursales{org ? ` de ${org.name}` : ''}</h2>
      <Flash sp={sp} />
      <p className="muted">Su organización puede tener todas las sucursales que necesite y está aislada de las demás. Marque como «sede central» la sucursal a la que se asocian los enrolamientos.</p>
      {org && (
        <>
          <div className="card">
            <h3>Códigos de empleado de {org.name}</h3>
            <p>Formato: <span className="mono">{orgRow?.employee_code_prefix}-000001</span> · próximo número: <b>{orgRow?.next_employee_number}</b></p>
            {canManage && (
              <form action={setPrefix} className="inline">
                <OrgField org={org.id} />
                <label>Prefijo (2–6 letras/números)<input name="prefix" defaultValue={orgRow?.employee_code_prefix} required pattern="[A-Za-z0-9]{2,6}" maxLength={6} style={{ minWidth: 90 }} /></label>
                <button className="secondary">Cambiar prefijo</button>
              </form>
            )}
            <p className="muted">Los códigos ya asignados no cambian.</p>
          </div>
          <div className="card">
            <h3>Regiones / países de {org.name}</h3>
            <table><thead><tr><th>País</th><th>Región</th><th>Zona horaria</th></tr></thead><tbody>
              {(regions ?? []).map((r) => <tr key={r.id}><td>{r.country_code}</td><td>{r.name}</td><td className="mono">{r.timezone}</td></tr>)}
            </tbody></table>
            {canManage && (
              <form action={createRegion} className="inline" style={{ marginTop: 12 }}>
                <OrgField org={org.id} />
                <label>País (ISO)<input name="country_code" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="GT" style={{ minWidth: 70 }} /></label>
                <label>Nombre<input name="name" required /></label>
                <label>Zona horaria<input name="timezone" required list="tz" placeholder="America/Guatemala" /></label>
                <datalist id="tz">{TZ.map((t) => <option key={t} value={t} />)}</datalist>
                <button>Añadir región</button>
              </form>
            )}
          </div>
          <div className="card">
            <h3>Sedes</h3>
            <table><thead><tr><th>Código</th><th>Nombre</th><th>Región</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
              {(stores ?? []).map((st) => (
                <tr key={st.id}>
                  <td className="mono">{st.code}</td><td>{st.name}<div className="muted">{st.address}</div></td>
                  <td>{(st.regions as { name: string; country_code: string } | null)?.country_code} · {(st.regions as { name: string } | null)?.name}</td>
                  <td>{st.is_central ? <span className="badge ok">Sede central</span> : 'Tienda'}</td>
                  <td>{st.status === 'active' ? <span className="badge ok">Activa</span> : <span className="badge">Cerrada</span>}</td>
                  <td>{canManage && (
                    <form action={setStoreStatus}><OrgField org={org.id} /><input type="hidden" name="id" value={st.id} />
                      <input type="hidden" name="status" value={st.status === 'active' ? 'closed' : 'active'} />
                      <button className="secondary">{st.status === 'active' ? 'Cerrar' : 'Reabrir'}</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody></table>
            {canManage && (regions?.length ? (
              <form action={createStore} className="inline" style={{ marginTop: 12 }}>
                <OrgField org={org.id} />
                <label>Región<select name="region_id" required>{regions.map((r) => <option key={r.id} value={r.id}>{r.country_code} · {r.name}</option>)}</select></label>
                <label>Código<input name="code" required pattern="[A-Za-z0-9_\-]{1,40}" placeholder="S01" style={{ minWidth: 80 }} /></label>
                <label>Nombre<input name="name" required placeholder="Sucursal 1" /></label>
                <label>Dirección<input name="address" /></label>
                <label>Zona horaria (opcional)<input name="timezone" list="tz" placeholder="la de la región" /></label>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="is_central" style={{ minWidth: 0 }} /> Sede central</label>
                <button>Añadir sede</button>
              </form>
            ) : <p className="muted">Cree primero una región.</p>)}
          </div>
        </>
      )}
    </>
  );
}
