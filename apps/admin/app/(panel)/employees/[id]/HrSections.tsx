import type { Ctx } from '@/lib/context';
import { OrgField } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { ALERT_STATUS, DISC_STATUS, DOC_KIND, EMP_EVENT, EMP_STATUS, END_TYPE, MEASURE, fmtDate, fmtTime } from '@/lib/hr';
import { createRecord, followupRecord, reinstate, rehire, suspend, terminate, voidDocument, voidRecord } from '../hr-actions';
import { DocUpload } from './DocUpload';

type Emp = { id: string; organization_id: string; status: string; first_name: string; last_name: string };
type Store = { id: string; code: string; name: string };
const today = () => new Date().toISOString().slice(0, 10);

/** Situación laboral: suspensión, reintegro, baja (inmediata o programada) y recontratación. */
export async function LifecycleCard({ ctx, e, stores }: { ctx: Ctx; e: Emp; stores: Store[] }) {
  const { supabase, org, orgWide } = ctx;
  const manage = orgWide('employee.manage');
  const [{ data: open }, { data: causes }] = await Promise.all([
    supabase.from('employment_periods').select('id, started_on, ended_on, end_type').eq('employee_id', e.id).order('period_no', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('hr_catalog').select('id, label').eq('organization_id', e.organization_id).eq('kind', 'termination_cause').eq('active', true).order('sort'),
  ]);
  const [label, cls] = EMP_STATUS[e.status] ?? [e.status, ''];
  const scheduled = open?.ended_on && e.status !== 'terminated';
  return (
    <div className="card">
      <h3>Situación laboral: <span className={`badge ${cls}`}>{label}</span></h3>
      {open && <p className="muted">Período actual desde {fmtDate(open.started_on)}{open.ended_on ? ` hasta ${fmtDate(open.ended_on)} (${END_TYPE[open.end_type ?? ''] ?? ''})` : ''}.</p>}
      {scheduled && <div className="notice">Baja programada para el {fmtDate(open!.ended_on)}. Hasta esa fecha sigue activo y puede marcar.</div>}
      {manage && org && e.status === 'active' && !scheduled && (
        <>
          <details><summary>Registrar salida (baja)</summary>
            <form action={terminate} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Tipo de salida<select name="end_type" required defaultValue="">
                <option value="" disabled>Seleccione…</option>{Object.entries(END_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              {!!causes?.length && <label>Causa (catálogo)<select name="cause_id" defaultValue=""><option value="">—</option>{causes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
              <label>Fecha efectiva (si es futura, la baja se aplica ese día)<input type="date" name="effective_on" required defaultValue={today()} /></label>
              <label>Motivo específico<input name="reason" required minLength={5} /></label>
              <label>Comentarios administrativos<textarea name="comments" rows={2} /></label>
              <label>Observaciones adicionales<textarea name="notes" rows={2} /></label>
              <p className="muted" style={{ margin: 0 }}>Efectos: queda inactivo, deja de consumir cupo, se revoca su autorización para marcar (los teléfonos lo retiran al sincronizar)
                y su plantilla facial se elimina a los 30 días. Todo su historial se conserva. Puede adjuntar documentos abajo, en «Documentos».</p>
              <button className="danger">Registrar baja</button>
            </form>
          </details>
          <details style={{ marginTop: 8 }}><summary>Suspender temporalmente</summary>
            <form action={suspend} className="inline" style={{ marginTop: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Desde<input type="date" name="from" defaultValue={today()} /></label>
              <label>Hasta (opcional)<input type="date" name="until" /></label>
              <label>Motivo<input name="reason" required minLength={5} /></label>
              <button className="secondary">Suspender</button>
            </form>
          </details>
        </>
      )}
      {manage && org && e.status === 'suspended' && (
        <form action={reinstate} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
          <label>Nota<input name="notes" placeholder="fin de suspensión" /></label><button>Reintegrar</button></form>
      )}
      {manage && org && e.status === 'terminated' && (
        <details><summary>Recontratar (nuevo período laboral)</summary>
          <form action={rehire} className="inline" style={{ marginTop: 8 }}>
            <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
            <label>Fecha de reingreso<input type="date" name="started_on" required defaultValue={today()} /></label>
            <label>Sucursal<select name="store_id"><option value="">—</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
            <label>Notas<input name="notes" /></label>
            <button>Recontratar</button>
          </form>
          <p className="muted">Se conserva la misma identidad e historial; se abre un período nuevo. Para marcar debe volver a enrolar su rostro.</p>
        </details>
      )}
    </div>
  );
}

/** Expediente: historial laboral, puntualidad, disciplina/reconocimientos y documentos. */
export async function HrSections({ ctx, e, stores }: { ctx: Ctx; e: Emp; stores: Store[] }) {
  const { supabase, org, can, orgWide } = ctx;
  if (!org || !can('hr.read') || !ctx.feature('hr')) return null;
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const [periods, events, flags, alerts, corrections, incidents, records, docs, cats, admins] = await Promise.all([
    supabase.from('employment_periods').select('*, hr_catalog(label)').eq('employee_id', e.id).order('period_no', { ascending: false }),
    supabase.from('employment_events').select('*').eq('employee_id', e.id).order('recorded_at', { ascending: false }).limit(50),
    supabase.from('attendance_day_flags').select('*, stores(timezone)').eq('employee_id', e.id).gte('work_date', since).order('work_date', { ascending: false }),
    supabase.from('alerts').select('*').eq('employee_id', e.id).order('period_key', { ascending: false }),
    supabase.from('attendance_corrections').select('id, kind, reason, created_at').eq('employee_id', e.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('employee_id', e.id),
    supabase.from('disciplinary_records').select('*, hr_catalog(label), stores(code)').eq('employee_id', e.id).order('incident_date', { ascending: false }),
    supabase.from('hr_documents').select('*').eq('employee_id', e.id).order('uploaded_at', { ascending: false }),
    supabase.from('hr_catalog').select('id, label').eq('organization_id', e.organization_id).eq('kind', 'discipline_category').eq('active', true).order('sort'),
    supabase.from('admins').select('user_id, display_name'),
  ]);
  const who = (id: string | null) => (admins.data ?? []).find((a) => a.user_id === id)?.display_name ?? '—';
  const lates = (flags.data ?? []).filter((f) => f.kind === 'late');
  const noShows = (flags.data ?? []).filter((f) => f.kind === 'no_show');
  const recIds = (records.data ?? []).map((r) => r.id);
  const fu = recIds.length ? (await supabase.from('disciplinary_followups').select('*').in('record_id', recIds).order('created_at')).data ?? [] : [];
  const canRecord = can('discipline.record') || can('discipline.manage');
  const canVoid = orgWide('discipline.manage');
  const docsOk = (docs.data ?? []).filter((d) => !d.voided_at);
  const signed = docsOk.length ? (await supabase.storage.from('hr-documents').createSignedUrls(docsOk.map((d) => d.storage_path), 300)).data ?? [] : [];
  const urlOf = (p: string) => signed.find((x) => x.path === p)?.signedUrl ?? undefined;
  return (
    <>
      <div className="card">
        <h3>Historial laboral</h3>
        <table><thead><tr><th>#</th><th>Ingreso</th><th>Salida</th><th>Tipo y motivo</th><th>Registrado por</th></tr></thead><tbody>
          {(periods.data ?? []).map((p) => (
            <tr key={p.id}><td>{p.period_no}</td><td>{fmtDate(p.started_on)}</td><td>{p.ended_on ? fmtDate(p.ended_on) : <span className="badge ok">vigente</span>}</td>
              <td>{p.end_type ? <><b>{END_TYPE[p.end_type]}</b>{(p.hr_catalog as { label: string } | null)?.label ? ` · ${(p.hr_catalog as { label: string }).label}` : ''}
                <div>{p.end_reason}</div>{p.end_comments && <div className="muted">Comentarios: {p.end_comments}</div>}{p.end_notes && <div className="muted">Observaciones: {p.end_notes}</div>}</> : '—'}</td>
              <td>{p.end_recorded_at ? <>{who(p.end_recorded_by)}<div className="muted">{fmtDateTime(p.end_recorded_at)}</div></> : '—'}</td></tr>
          ))}
        </tbody></table>
        <h4>Eventos</h4>
        <ul className="muted">{(events.data ?? []).map((v) => (
          <li key={v.id}>{fmtDate(v.effective_on)} — <b>{EMP_EVENT[v.kind] ?? v.kind}</b>
            {v.details?.reason ? `: ${v.details.reason}` : v.details?.notes ? `: ${v.details.notes}` : ''}{v.details?.until ? ` (hasta ${fmtDate(v.details.until)})` : ''}
            {' '}· {who(v.recorded_by)}</li>
        ))}</ul>
      </div>

      {can('attendance.read') && (
        <div className="card">
          <h3>Puntualidad (últimos 6 meses)</h3>
          <p><b>{lates.length}</b> llegadas tarde · <b>{noShows.length}</b> días con horario sin marcación · <b>{corrections.data?.length ?? 0}</b> correcciones · <b>{incidents.count ?? 0}</b> incidencias</p>
          <p className="muted">Solo se evalúa cuando hay un horario de referencia asignado (Horarios). «Sin marcación» no se confirma como ausencia injustificada: requiere revisión.</p>
          {!!flags.data?.length && (
            <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Entrada programada</th><th>Primera entrada</th><th>Minutos tarde</th></tr></thead><tbody>
              {flags.data.slice(0, 40).map((f) => {
                const tz = (f.stores as { timezone: string } | null)?.timezone;
                return <tr key={f.work_date}><td>{fmtDate(f.work_date)}</td><td>{f.kind === 'late' ? <span className="badge warn">Tarde</span> : <span className="badge">Sin marcación</span>}</td>
                  <td>{fmtTime(f.scheduled_start, tz)} (tolerancia {f.tolerance_minutes} min)</td><td>{fmtTime(f.first_in_at, tz)}</td><td>{f.minutes_late ?? '—'}</td></tr>;
              })}
            </tbody></table>
          )}
          {!!alerts.data?.length && <p>Alertas: {alerts.data.map((a) => <span key={a.id} style={{ marginRight: 8 }}><a href={`/alerts?org=${org.id}&id=${a.id}`}>{a.period_key}: {a.count} tardanzas</a> <span className={`badge ${ALERT_STATUS[a.status]?.[1]}`}>{ALERT_STATUS[a.status]?.[0]}</span></span>)}</p>}
          {!!corrections.data?.length && <details><summary>Correcciones de asistencia</summary><ul className="muted">{corrections.data.map((c) => <li key={c.id}>{fmtDateTime(c.created_at)} — {c.kind}: {c.reason}</li>)}</ul></details>}
        </div>
      )}

      <div className="card">
        <h3>Disciplina y reconocimientos</h3>
        <p className="muted">Nada se borra: un registro erróneo se anula con motivo y queda en la auditoría. El sistema no aplica sanciones ni genera cartas automáticamente.</p>
        {(records.data ?? []).map((r) => {
          const [sl, sc] = DISC_STATUS[r.status] ?? [r.status, ''];
          return (
            <details key={r.id} className="card" style={{ marginBottom: 8, opacity: r.status === 'voided' ? 0.6 : 1 }}>
              <summary><b>{fmtDate(r.incident_date)}</b> · {r.kind === 'recognition' ? '🏅 Reconocimiento' : MEASURE[r.measure ?? ''] ?? 'Medida'}
                {(r.hr_catalog as { label: string } | null)?.label ? ` · ${(r.hr_catalog as { label: string }).label}` : ''} <span className={`badge ${sc}`}>{sl}</span></summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
              {r.admin_comments && <p className="muted">Comentarios: {r.admin_comments}</p>}
              <p className="muted">Registrado por {who(r.created_by)} el {fmtDateTime(r.created_at)}{r.stores ? ` · sucursal ${(r.stores as { code: string }).code}` : ''} ·
                {r.employee_informed ? ` informado al empleado ${r.informed_at ? fmtDateTime(r.informed_at) : ''}` : ' aún no informado al empleado'}</p>
              {r.void_reason && <p className="msg error">Anulado por {who(r.voided_by)}: {r.void_reason}</p>}
              <ul className="muted">{fu.filter((f) => f.record_id === r.id).map((f) => (
                <li key={f.id}>{fmtDateTime(f.created_at)} · {who(f.created_by)}: {f.status_from !== f.status_to ? `${DISC_STATUS[f.status_from]?.[0]} → ${DISC_STATUS[f.status_to]?.[0]}. ` : ''}{f.comment}</li>
              ))}</ul>
              {canRecord && r.status !== 'voided' && (
                <form action={followupRecord} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="record_id" value={r.id} />
                  <label>Nuevo estado<select name="status" defaultValue=""><option value="">(sin cambio)</option>
                    {['pending', 'in_review', 'communicated', 'resolved', 'closed'].map((k) => <option key={k} value={k}>{DISC_STATUS[k]![0]}</option>)}</select></label>
                  <label>Seguimiento<input name="comment" required minLength={3} style={{ minWidth: 260 }} /></label><button className="secondary">Agregar</button></form>
              )}
              {canVoid && r.status !== 'voided' && (
                <form action={voidRecord} className="inline" style={{ marginTop: 6 }}><OrgField org={org.id} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="record_id" value={r.id} />
                  <input name="reason" placeholder="motivo de la anulación (mín. 10)" required minLength={10} style={{ minWidth: 260 }} /><button className="danger">Anular</button></form>
              )}
            </details>
          );
        })}
        {!records.data?.length && <p className="muted">Sin registros.</p>}
        {canRecord && e.status !== 'terminated' && (
          <details style={{ marginTop: 8 }}><summary>Nuevo registro</summary>
            <form action={createRecord} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <OrgField org={org.id} /><input type="hidden" name="id" value={e.id} />
              <label>Tipo<select name="kind" defaultValue="disciplinary"><option value="disciplinary">Medida disciplinaria / llamada de atención</option><option value="recognition">Reconocimiento</option></select></label>
              <label>Fecha del incidente<input type="date" name="incident_date" required max={today()} defaultValue={today()} /></label>
              <label>Categoría<select name="category_id" defaultValue=""><option value="">—</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              <label>Medida (solo disciplinaria)<select name="measure" defaultValue="verbal">{Object.entries(MEASURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Sucursal<select name="store_id" defaultValue=""><option value="">—</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
              <label>Descripción de los hechos (mín. 10 caracteres)<textarea name="description" required minLength={10} rows={3} /></label>
              <label>Comentarios administrativos<textarea name="admin_comments" rows={2} /></label>
              <label style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="checkbox" name="employee_informed" style={{ minWidth: 0 }} /> Ya se informó al empleado</label>
              <button>Guardar registro</button>
            </form>
          </details>
        )}
      </div>

      <div className="card">
        <h3>Documentos</h3>
        <p className="muted">Almacenamiento privado; los enlaces de descarga vencen a los 5 minutos.</p>
        <table><thead><tr><th>Documento</th><th>Relacionado</th><th>Subido</th><th></th></tr></thead><tbody>
          {(docs.data ?? []).map((d) => (
            <tr key={d.id} style={{ opacity: d.voided_at ? 0.6 : 1 }}>
              <td><b>{d.doc_type}</b><div>{d.voided_at ? d.file_name : <a href={urlOf(d.storage_path)} target="_blank" rel="noreferrer">{d.file_name}</a>}</div>
                {d.void_reason && <div className="muted">Anulado: {d.void_reason}</div>}</td>
              <td>{DOC_KIND[d.related_type] ?? d.related_type}</td><td>{fmtDateTime(d.uploaded_at)}<div className="muted">{who(d.uploaded_by)}</div></td>
              <td>{orgWide('hr.manage') && !d.voided_at && (
                <form action={voidDocument} className="inline"><OrgField org={org.id} /><input type="hidden" name="id" value={e.id} /><input type="hidden" name="document_id" value={d.id} />
                  <input name="reason" placeholder="motivo" required minLength={5} style={{ minWidth: 100 }} /><button className="secondary">Anular</button></form>
              )}</td>
            </tr>
          ))}
          {!docs.data?.length && <tr><td colSpan={4} className="muted">Sin documentos.</td></tr>}
        </tbody></table>
        {(orgWide('hr.manage') || orgWide('discipline.manage')) && <DocUpload orgId={e.organization_id} employeeId={e.id} />}
      </div>
    </>
  );
}
