import { getContext } from '@/lib/context';
import { Flash, type SP } from '@/components/Flash';
import { fmtDateTime } from '@/lib/format';
import { computeMetrics, padSweep, thresholdSweep, type Rate, type TrialRow } from '@/lib/biometricMetrics';

const COND: Record<string, string> = { genuine: 'Persona enrolada', impostor: 'Persona no enrolada', attack_print: 'Foto impresa', attack_screen: 'Foto en pantalla',
  attack_video: 'Vídeo en pantalla', attack_other: 'Otro ataque', benchmark: 'Medición 1:N' };
const OUT: Record<string, string> = { identified: 'Reconocido', not_recognized: 'No reconocido', ambiguous: 'Dudoso', liveness_failed: 'Prueba de vida no superada',
  timeout: 'Tiempo agotado', uncalibrated: 'Sin calibrar', no_templates: 'Sin plantillas', engine_error: 'Error del motor', benchmark: '—' };
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)} %`);
/** Tasa con su muestra e intervalo: «2 de 40 · 5,0 % (IC 95 %: 1,4–16,5 %)». Nunca un porcentaje solo. */
function R({ r }: { r: Rate }) {
  if (!r.n) return <span className="muted">sin datos</span>;
  return <span><b>{r.k} de {r.n}</b> · {pct(r.rate)} <span className="muted">(IC 95 %: {pct(r.lo)}–{pct(r.hi)})</span></span>;
}
const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`);

/** Validación biométrica con personas y teléfonos reales: resultados medidos (modo validación de la app). */
export default async function Biometrics({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, org, can } = await getContext(sp.org);
  if (!org) return <p>Sin organización.</p>;
  if (!can('audit.read')) return <p>Sin permiso para ver la validación biométrica.</p>;
  let q = supabase.from('biometric_trials').select('*, devices(label), employees!biometric_trials_expected_employee_id_organization_id_fkey(first_name, last_name)')
    .eq('organization_id', org.id).order('captured_at', { ascending: false }).limit(5000);
  if (sp.from) q = q.gte('captured_at', sp.from);
  if (sp.to) q = q.lte('captured_at', sp.to + 'T23:59:59');
  if (sp.device) q = q.eq('device_id', sp.device);
  if (sp.mode) q = q.eq('challenge_mode', sp.mode);
  const [{ data, error }, { data: devices }] = await Promise.all([q, supabase.from('devices').select('id, label').eq('organization_id', org.id).order('label')]);
  const all = (data ?? []) as (TrialRow & { id: string; devices: { label: string } | null; recognition_model: string | null; app_version: string | null;
    employees: { first_name: string; last_name: string } | null; timings: Record<string, unknown>; match_threshold: number | null; pad_threshold: number | null })[];
  const trials = all.filter((r) => r.condition !== 'benchmark');
  const benches = all.filter((r) => r.condition === 'benchmark');
  const m = computeMetrics(trials), sw = thresholdSweep(trials), ps = padSweep(trials);
  const models = [...new Set(trials.map((r) => `${r.recognition_model} · app ${r.app_version}`))];
  return (
    <>
      <h2>Validación biométrica</h2>
      <Flash sp={sp} />
      <div className="notice">Resultados <b>medidos</b> con el «modo validación» de la app (misma cadena que la marcación, sin registrar asistencia y sin fotos).
        Motor gratuito <b>EXPERIMENTAL</b> (SFace + MiniFASNet). Estas cifras no son una certificación (ISO/IEC 30107-3, iBeta): describen solo
        las personas, teléfonos y condiciones probadas. Con pocas pruebas el intervalo de confianza es amplio.</div>
      <form className="inline" method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="org" value={org.id} />
        <label>Desde<input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
        <label>Hasta<input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
        <label>Teléfono<select name="device" defaultValue={sp.device ?? ''}><option value="">Todos</option>{(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label>Prueba de vida<select name="mode" defaultValue={sp.mode ?? ''}><option value="">Todas</option><option value="blink">Parpadeo</option>
          <option value="random">Aleatoria</option><option value="none">Solo pasiva</option></select></label>
        <button className="secondary">Filtrar</button>
      </form>
      {error && <div className="msg error">{error.message}</div>}
      {!trials.length ? (
        <div className="card"><p>Aún no hay pruebas registradas. En el teléfono: botón <b>⚙ Opciones</b> (abajo a la derecha) → <b>Validación biométrica</b>.
          Protocolo sugerido en docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md (al menos 10 personas, 10 intentos cada una, y 20 intentos por tipo de ataque).</p></div>
      ) : (
        <>
          <p className="muted">{trials.length} intentos · {new Set(trials.map((r) => r.expected_employee_id).filter(Boolean)).size} personas enroladas distintas · modelos: {models.join('; ')}</p>
          <table><thead><tr><th>Indicador</th><th>Resultado</th><th>Qué significa</th></tr></thead><tbody>
            <tr><td><b>FRR</b> (personas enroladas no reconocidas)</td><td><R r={m.genuine.frr} /></td><td>Rechazos de trabajadores legítimos: por prueba de vida, no reconocido, dudoso o tiempo.</td></tr>
            <tr><td><b>Identificación errónea</b></td><td><R r={m.genuine.misidentified} /></td><td>Reconoció a OTRA persona enrolada (marcación a nombre equivocado).</td></tr>
            <tr><td><b>FAR</b> (desconocidos aceptados)</td><td><R r={m.impostor.far} /></td><td>Personas no enroladas que el sistema reconoció como empleado.</td></tr>
            <tr><td><b>BPCER</b> (personas reales rechazadas por la prueba de vida)</td><td><R r={m.bpcer} /></td><td>Molestia para el trabajador: personas reales tratadas como ataque.</td></tr>
            <tr><td><b>APCER</b> (ataques no detenidos por la prueba de vida)</td><td><R r={m.attacksTotal.apcer} /></td><td>Fotos/pantallas/vídeos que superaron la prueba de vida.</td></tr>
            <tr><td><b>Ataques que lograron marcar</b></td><td><R r={m.attacksTotal.punched} /></td><td>Ataques que además fueron reconocidos como un empleado.</td></tr>
          </tbody></table>
          <h3>Por tipo de ataque</h3>
          <table><thead><tr><th>Ataque</th><th>Intentos</th><th>APCER (no detenidos)</th><th>Lograron marcar</th><th>Terminados por tiempo</th></tr></thead><tbody>
            {m.attacks.map((a) => <tr key={a.type}><td>{COND[a.type]}</td><td>{a.total}</td><td><R r={a.apcer} /></td><td><R r={a.punched} /></td><td>{a.timeouts}</td></tr>)}
          </tbody></table>
          <h3>Motivos de rechazo de personas enroladas</h3>
          <p>{m.genuine.reasons.length ? m.genuine.reasons.map(([k, v]) => `${OUT[k.split(':')[0]!] ?? k}${k.includes(':') ? ` (${k.split(':')[1]})` : ''}: ${v}`).join(' · ') : 'ninguno'}</p>
          <h3>Rendimiento en el teléfono</h3>
          <p>Tiempo hasta reconocer (aciertos, n={m.latency.n}): mediana <b>{ms(m.latency.p50)}</b> · p95 <b>{ms(m.latency.p95)}</b> ·
            por fotograma: detección {ms(m.latency.detectMs)}, embedding {ms(m.latency.embedMs)}, prueba pasiva {ms(m.latency.padMs)} · desafío {ms(m.latency.challengeMs)}
            {m.memoryMb && <> · memoria JS {m.memoryMb.min}–{m.memoryMb.max} MB</>}</p>
          <h3>Calibración del umbral de reconocimiento</h3>
          <p className="muted">Solo reconocimiento (sin prueba de vida), con la puntuación del mejor candidato. Genuinas: {sw.genuineN} · impostoras: {sw.impostorN}.
            Elija el umbral donde FMR sea prácticamente 0 con FNMR aceptable; publíquelo en «Política offline».</p>
          <table><thead><tr><th>Umbral</th><th>FNMR (genuinas por debajo)</th><th>FMR (impostoras por encima)</th></tr></thead><tbody>
            {sw.rows.map((r) => <tr key={r.t}><td>{r.t.toFixed(2)}</td><td><R r={r.fnmr} /></td><td><R r={r.fmr} /></td></tr>)}
          </tbody></table>
          <h3>Calibración de la prueba de vida pasiva</h3>
          <p className="muted">Personas reales: {ps.realN} · ataques: {ps.attackN}. La pasiva se combina con el desafío activo; esta tabla mide solo la pasiva.</p>
          <table><thead><tr><th>Umbral</th><th>BPCER (reales por debajo)</th><th>APCER (ataques por encima)</th></tr></thead><tbody>
            {ps.rows.map((r) => <tr key={r.t}><td>{r.t.toFixed(2)}</td><td><R r={r.bpcer} /></td><td><R r={r.apcer} /></td></tr>)}
          </tbody></table>
        </>
      )}
      {!!benches.length && (
        <>
          <h3>Búsqueda 1:N medida en teléfonos</h3>
          <table><thead><tr><th>Fecha</th><th>Teléfono</th><th>ms por búsqueda según empleados en la galería (3 plantillas c/u)</th></tr></thead><tbody>
            {benches.slice(0, 20).map((b) => <tr key={b.id}><td>{fmtDateTime(b.captured_at)}</td><td>{b.devices?.label}</td>
              <td className="mono">{Object.entries(((b.timings?.benchmark as { msByGallerySize?: Record<string, number> })?.msByGallerySize) ?? {}).map(([k, v]) => `${k.slice(1)}: ${v}`).join(' · ')}</td></tr>)}
          </tbody></table>
        </>
      )}
      {!!trials.length && (
        <>
          <h3>Últimos intentos</h3>
          <table><thead><tr><th>Fecha</th><th>Teléfono</th><th>Condición</th><th>Resultado</th><th>Mejor / 2.º</th><th>Pasiva</th><th>Total</th><th>Batería</th></tr></thead><tbody>
            {trials.slice(0, 100).map((r) => (
              <tr key={r.id}><td>{fmtDateTime(r.captured_at)}</td><td>{r.devices?.label}</td>
                <td>{COND[r.condition]}{r.employees ? `: ${r.employees.last_name}, ${r.employees.first_name}` : ''}<div className="muted">{r.lighting} · {r.challenge_mode}</div></td>
                <td>{OUT[r.outcome] ?? r.outcome}{r.outcome_reason ? ` (${r.outcome_reason})` : ''}
                  {r.condition === 'genuine' && r.outcome === 'identified' && r.identified_employee_id !== r.expected_employee_id && <span className="badge err"> otra persona</span>}</td>
                <td>{r.top1_score?.toFixed(3) ?? '—'} / {r.top2_score?.toFixed(3) ?? '—'}</td><td>{r.passive_score?.toFixed(3) ?? '—'}</td><td>{ms(r.total_ms)}</td>
                <td>{typeof r.device_info?.battery === 'number' ? `${Math.round((r.device_info.battery as number) * 100)} %` : '—'}</td></tr>
            ))}
          </tbody></table>
        </>
      )}
    </>
  );
}
