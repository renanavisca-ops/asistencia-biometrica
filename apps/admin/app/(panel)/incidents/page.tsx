import { getContext } from '@/lib/context';
import { Flash, OrgField, type SP } from '@/components/Flash';
import { fmtDateTime, INCIDENT_LABEL, EVENT_LABEL } from '@/lib/format';
import { correct, resolveIncident } from './actions';

export default async function Incidents({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, can } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  const status = sp.status ?? 'open';
  let q = supabase.from('incidents').select('*, employees(first_name, last_name, employee_code), stores(code, name, timezone), devices(label)')
    .eq('organization_id', org.id).eq('status', status).order('opened_at', { ascending: false }).limit(200);
  if (sp.kind) q = q.eq('kind', sp.kind);
  const { data: incidents } = await q;
  const eventIds = [...new Set((incidents ?? []).flatMap((i) => i.event_ids as string[]))];
  const { data: events } = eventIds.length
    ? await supabase.from('attendance_events').select('id, event_type, occurred_at, status, review_reasons, source, devices(label)').in('id', eventIds)
    : { data: [] };
  const { data: corrections } = eventIds.length
    ? await supabase.from('attendance_corrections').select('target_event_id, kind').in('target_event_id', eventIds)
    : { data: [] };
  const ev = new Map((events ?? []).map((e) => [e.id, e]));
  const corrected = new Map((corrections ?? []).map((c) => [c.target_event_id, c.kind]));
  const canResolve = can('incident.resolve'), canCorrect = can('attendance.correct');
  return (
    <>
      <h2>Incidencias</h2>
      <Flash sp={sp} />
      <p className="muted">El sistema nunca inventa marcaciones. Las anomalías se resuelven aquí con justificación; cada corrección conserva el evento original y queda en la auditoría.</p>
      <form className="inline card" method="get">
        <OrgField org={org.id} />
        <label>Estado<select name="status" defaultValue={status}><option value="open">Abiertas</option><option value="resolved">Resueltas</option><option value="dismissed">Descartadas</option></select></label>
        <label>Tipo<select name="kind" defaultValue={sp.kind ?? ''}><option value="">Todos</option>{Object.entries(INCIDENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="secondary">Filtrar</button>
      </form>
      {!incidents?.length && <p className="muted">No hay incidencias con estos filtros.</p>}
      {(incidents ?? []).map((i) => {
        const emp = i.employees as { first_name: string; last_name: string; employee_code: string } | null;
        const st = i.stores as { code: string; name: string; timezone: string } | null;
        return (
          <div className="card" key={i.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <b>{INCIDENT_LABEL[i.kind] ?? i.kind}</b> <span className={`badge ${i.severity === 'high' ? 'err' : i.severity === 'medium' ? 'warn' : ''}`}>{i.severity}</span>
                <div className="muted">{fmtDateTime(i.opened_at)} · {st ? `${st.code} ${st.name}` : 'sin sede'} {emp && `· ${emp.last_name}, ${emp.first_name} #${emp.employee_code}`} {(i.devices as { label: string } | null)?.label && `· ${(i.devices as { label: string }).label}`}</div>
              </div>
              {i.status !== 'open' && <div className="muted">Resuelta {fmtDateTime(i.resolved_at)}: {i.resolution}</div>}
            </div>
            {Object.keys(i.details ?? {}).length > 0 && <pre className="mono muted" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(i.details)}</pre>}
            {(i.event_ids as string[]).length > 0 && (
              <table style={{ marginTop: 8 }}><thead><tr><th>Evento</th><th>Hora</th><th>Estado</th><th>Origen</th>{canCorrect && i.status === 'open' && <th>Corregir</th>}</tr></thead><tbody>
                {(i.event_ids as string[]).map((id) => {
                  const e = ev.get(id);
                  if (!e) return null;
                  return (
                    <tr key={id}><td>{EVENT_LABEL[e.event_type]} <span className="muted mono">{id.slice(0, 8)}</span></td><td>{fmtDateTime(e.occurred_at, st?.timezone)}</td>
                      <td>{e.status}{e.review_reasons?.length ? <div className="muted">{(e.review_reasons as string[]).join(', ')}</div> : null}{corrected.get(id) && <span className="badge">{corrected.get(id) === 'void' ? 'anulado' : 'confirmado'}</span>}</td>
                      <td>{e.source} {(e.devices as unknown as { label: string } | null)?.label}</td>
                      {canCorrect && i.status === 'open' && (
                        <td>{!corrected.get(id) && i.employee_id && (
                          <form action={correct} className="inline">
                            <OrgField org={org.id} /><input type="hidden" name="employee_id" value={i.employee_id} /><input type="hidden" name="target_event_id" value={id} /><input type="hidden" name="incident_id" value={i.id} />
                            <select name="kind" style={{ minWidth: 100 }}><option value="confirm">Confirmar válido</option><option value="void">Anular</option></select>
                            <input name="reason" required minLength={10} placeholder="justificación (mín. 10)" />
                            <button className="secondary">Aplicar</button>
                          </form>
                        )}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody></table>
            )}
            {i.status === 'open' && (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {canCorrect && i.employee_id && i.store_id && ['missing_out', 'orphan_out', 'long_open_session'].includes(i.kind) && (
                  <form action={correct} className="inline">
                    <OrgField org={org.id} /><input type="hidden" name="kind" value="add" /><input type="hidden" name="employee_id" value={i.employee_id} />
                    <input type="hidden" name="store_id" value={i.store_id} /><input type="hidden" name="incident_id" value={i.id} />
                    <label>Añadir marcación<select name="event_type" defaultValue={i.kind === 'orphan_out' ? 'IN' : 'OUT'}><option value="IN">Entrada</option><option value="OUT">Salida</option></select></label>
                    <label>Hora real (verificada)<input type="datetime-local" name="occurred_at" required /></label>
                    <label>Justificación<input name="reason" required minLength={10} /></label>
                    <button className="secondary">Añadir con auditoría</button>
                  </form>
                )}
                {canResolve && (
                  <form action={resolveIncident} className="inline">
                    <OrgField org={org.id} /><input type="hidden" name="id" value={i.id} />
                    <select name="status" style={{ minWidth: 110 }}><option value="resolved">Resolver</option><option value="dismissed">Descartar</option></select>
                    <input name="resolution" required minLength={10} placeholder="resolución (mín. 10 caracteres)" style={{ minWidth: 280 }} />
                    <button>Cerrar incidencia</button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
