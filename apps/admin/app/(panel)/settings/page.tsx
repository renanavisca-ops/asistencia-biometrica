import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { DEFAULT_POLICY } from '@asistencia/core';
import { createPolicy } from './actions';

const FIELDS: [keyof typeof DEFAULT_POLICY, string][] = [
  ['antiDoubleWindowSec', 'Ventana anti-doble marcación (s)'], ['longSessionHours', 'Permanencia larga: aviso (h)'],
  ['staleSessionHours', 'Sesión caducada: siguiente marca = ENTRADA (h)'], ['offlineMaxHours', 'Máx. horas sin sincronizar antes de bloquear (0 = no bloquear)'],
  ['leaseHours', 'Validez de autorización de empleados sin renovar (h)'], ['serverTimeStaleHours', 'Horas sin hora de servidor → hora dudosa'],
  ['maxFailedAttempts', 'Intentos fallidos antes de pausa'], ['cooldownSec', 'Pausa tras intentos fallidos (s)'], ['confirmationSec', 'Duración de la confirmación (s)'],
];

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, orgWide } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const { data: versions } = await supabase.from('device_policy_versions').select('*').eq('organization_id', org.id).order('version', { ascending: false });
  const current = (versions?.[0]?.policy ?? DEFAULT_POLICY) as Record<string, number | null>;
  return (
    <>
      <h2>Política de operación offline</h2>
      <Flash sp={sp} />
      <p className="muted">Equilibrio continuidad/revocación: un teléfono desconectado no conoce altas, bajas ni traslados hasta sincronizar. Una validez de autorización más corta revoca antes, pero puede impedir marcar a empleados legítimos si la tienda pasa días sin internet. Ver docs/OFFLINE_SYNC.md.</p>
      <div className="card">
        <h3>Versión vigente: {versions?.[0]?.version ?? 'ninguna (valores por defecto)'}</h3>
        {orgWide('device.manage') ? (
          <form action={createPolicy} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <OrgField org={org.id} />
            {FIELDS.map(([k, label]) => <label key={k}>{label}<input name={k} type="number" step="1" min="0" required defaultValue={String(current[k] ?? DEFAULT_POLICY[k])} /></label>)}
            <label>Umbral de coincidencia (vacío = sin calibrar)<input name="matchThreshold" type="number" step="0.0001" defaultValue={current.matchThreshold ?? ''} /></label>
            <label>Margen mínimo entre candidatos<input name="matchMargin" type="number" step="0.0001" defaultValue={current.matchMargin ?? ''} /></label>
            <label>Umbral prueba de vida (PAD)<input name="padThreshold" type="number" step="0.0001" defaultValue={current.padThreshold ?? ''} /></label>
            <div><button>Publicar nueva versión</button></div>
          </form>
        ) : <pre className="mono">{JSON.stringify(current, null, 2)}</pre>}
      </div>
      <h3>Historial</h3>
      <table><thead><tr><th>Versión</th><th>Fecha</th><th>Política</th></tr></thead><tbody>
        {(versions ?? []).map((v) => <tr key={v.id}><td>{v.version}</td><td>{fmtDateTime(v.created_at)}</td><td className="mono">{JSON.stringify(v.policy)}</td></tr>)}
      </tbody></table>
    </>
  );
}
