import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { RosterEntry } from '@asistencia/core';
import { KioskService, nextBackoffMs, type PunchResult } from '../domain/kiosk.ts';
import type { OutKind } from '@asistencia/core';
import type { DeviceState, LocalEventStatus } from '../domain/store.ts';
import { simulatedIdentification } from '../infra/biometric/engine.ts';
import { getEngine } from '../infra/biometric/index.ts';
import { cooldownRemainingSec, recordFailure, recordSuccess } from '../infra/biometric/attempts.ts';
import { Camera } from './Camera.tsx';
import { formatCode, normalizeCode } from './activationCode.ts';
import { FaceCapture, type CaptureOutcome } from './FaceCapture.tsx';
import { EngineDiagnostics } from './EngineDiagnostics.tsx';
import { Enrollment } from './Enrollment.tsx';
import { OrgSignup } from './OrgSignup.tsx';

type View =
  | { name: 'loading' } | { name: 'setup' } | { name: 'home' } | { name: 'capture' }
  | { name: 'result'; result: PunchResult } | { name: 'blocked' } | { name: 'bio_fail'; outcome: CaptureOutcome } | { name: 'test_picker' }
  | { name: 'choose'; employeeId: string; result: Extract<PunchResult, { kind: 'choose_out' }> };

const fmtTime = (ms: number, tz: string) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(ms));
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
/** «Juan Esteban G.» → «Juan Esteban» (el saludo usa solo los nombres). */
const firstNames = (displayName: string) => displayName.replace(/\s+\S\.?$/, '') || displayName;
const welcome = (g: 'F' | 'M' | null) => (g === 'F' ? 'Bienvenida' : g === 'M' ? 'Bienvenido' : 'Bienvenido(a)');
/** Indicadores que NO son anomalías (no se muestran como «hora en revisión»). */
const NORMAL_FLAGS = new Set(['out_break', 'out_end', 'in_after_break', 'early_out_confirmed', 'long_session_out']);
const REFUSED: Record<string, string> = {
  not_activated: 'Teléfono no activado.', blocked: 'Teléfono bloqueado por administración.',
  unknown_employee: 'Persona no autorizada en esta tienda.', lease_expired: 'Autorización caducada: el teléfono necesita sincronizar con internet.',
  offline_too_long: 'Demasiado tiempo sin conexión: conecte el teléfono a internet para seguir marcando.',
  org_inactive: 'La membresía de la organización está vencida o la cuenta está suspendida. No se pueden registrar marcaciones; avise al administrador.', storage_error: 'Error al guardar. Intente de nuevo; si persiste, avise al encargado.',
};

export function KioskApp({ svc, persistent }: { svc: KioskService; persistent: boolean }) {
  const [view, setView] = useState<View>({ name: 'loading' });
  const [st, setSt] = useState<DeviceState | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [counts, setCounts] = useState<Record<LocalEventStatus, number> | null>(null);
  const [syncInfo, setSyncInfo] = useState<string>('');
  const [admin, setAdmin] = useState(false);
  const [diag, setDiag] = useState(false);
  const [enroll, setEnroll] = useState(false);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const s = await svc.status();
    setSt(s.state); setCounts(s.counts);
    setRoster(s.state ? await svc.store.getRoster() : []);
    return s.state;
  }, [svc]);

  const runSync = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const r = await svc.sync();
    const state = await refresh();
    if (r.ok) { attempt.current = 0; setSyncInfo(`OK · ${r.pushed} enviados · ${r.rosterSize} autorizados`); }
    else { setSyncInfo(`Sin sincronizar (${r.error})`); }
    if (state?.status && state.status !== 'active') { setView({ name: 'blocked' }); return; }
    const delay = r.ok ? 5 * 60_000 : r.retryable ? nextBackoffMs(attempt.current++) : 30 * 60_000;
    timer.current = setTimeout(runSync, delay);
  }, [svc, refresh]);

  useEffect(() => {
    getEngine().catch(() => {}); // precarga de modelos (local, sin red)
    (async () => {
      const s = await refresh();
      if (!s) return setView({ name: 'setup' });
      setView(s.status === 'active' ? { name: 'home' } : { name: 'blocked' });
      runSync();
    })();
    const onOnline = () => runSync();
    window.addEventListener('online', onOnline);
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) runSync(); });
    return () => { window.removeEventListener('online', onOnline); sub.then((h) => h.remove()); if (timer.current) clearTimeout(timer.current); };
  }, [refresh, runSync]);

  // Tras la confirmación vuelve solo a la pantalla inicial limpia (la cámara se apaga al desmontarse).
  useEffect(() => {
    if (view.name !== 'result') return;
    const r = view.result;
    const base = (st?.policy.confirmationSec ?? 4) * 1000;
    // El resumen del turno al salir necesita más tiempo de lectura.
    const t = setTimeout(() => setView({ name: 'home' }), r.kind === 'recorded' && r.eventType === 'OUT' ? Math.max(base, 8000) : Math.max(base, 5000));
    return () => clearTimeout(t);
  }, [view, st]);
  useEffect(() => {
    if (view.name !== 'choose') return;
    const t = setTimeout(() => setView({ name: 'home' }), 20_000); // sin respuesta: no se registra nada
    return () => clearTimeout(t);
  }, [view]);
  useEffect(() => {
    if (view.name !== 'capture') return;
    const t = setTimeout(() => setView({ name: 'home' }), 45_000); // inactividad
    return () => clearTimeout(t);
  }, [view]);

  const lastId = useRef<import('../domain/kiosk.ts').Identification | null>(null);
  const punchId = async (id: import('../domain/kiosk.ts').Identification, outKind?: OutKind) => {
    lastId.current = id;
    const result = await svc.punch(id, { outKind });
    if (result.kind === 'choose_out') { setView({ name: 'choose', employeeId: id.employeeId, result }); return; }
    setView({ name: 'result', result });
    refresh();
    if (result.kind === 'recorded') runSync();
  };
  const onCapture = (o: CaptureOutcome) => {
    const f2 = (x: number | null | undefined) => (x == null ? '-' : x.toFixed(2));
    if (o.kind === 'identified') { recordSuccess(`m${f2(o.id.matchScore)},g${f2(o.id.matchMargin)},p${f2(o.id.padScore)}`); return punchId(o.id); }
    if (['not_recognized', 'ambiguous', 'liveness_failed', 'timeout'].includes(o.kind) && st) {
      const detail = o.kind === 'not_recognized' ? `best${f2(o.bestScore)}/thr${f2(st.policy.matchThreshold)}`
        : o.kind === 'liveness_failed' ? `${f2(o.score)}/${f2(o.threshold)}`
        : o.kind === 'timeout' ? o.stage ?? '' : '';
      recordFailure(o.kind === 'liveness_failed' ? `pad_fail_${o.reason}` : o.kind, st.policy.maxFailedAttempts, st.policy.cooldownSec, detail);
    }
    // Transición: si nadie de la tienda tiene plantillas del motor real (enrolamiento pendiente), se permite el modo prueba etiquetado.
    if (o.kind === 'no_templates') return setView({ name: 'test_picker' });
    setView({ name: 'bio_fail', outcome: o });
  };
  const punch = async (employeeId: string, outKind?: OutKind) => {
    if (outKind && lastId.current?.employeeId === employeeId) return punchId(lastId.current, outKind);
    const result = await svc.punch(simulatedIdentification(employeeId), { outKind });
    if (result.kind === 'choose_out') { setView({ name: 'choose', employeeId, result }); return; }
    setView({ name: 'result', result });
    refresh();
    if (result.kind === 'recorded') runSync();
  };

  const footer = st && (
    <div className="footer" onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => { const t = setTimeout(() => setAdmin(true), 3000); const up = () => { clearTimeout(t); e.currentTarget?.removeEventListener('pointerup', up); }; e.currentTarget.addEventListener('pointerup', up); }}>
      <span>{st.storeName}</span>
      <span>{counts?.pending ? `${counts.pending} pendientes` : 'al día'} · v{st.policy.version} · ⚙ mantener 3 s</span>
    </div>
  );

  return (
    <>
      {view.name !== 'loading' && (
        <div className="banner-test">PRUEBA — reconocimiento y prueba de vida experimentales · no apto para uso real</div>
      )}
      {!persistent && view.name !== 'loading' && <div className="banner-test" style={{ top: 32, background: '#e5484d', color: '#fff' }}>NAVEGADOR: datos no persistentes</div>}
      {view.name === 'loading' && <div className="screen muted">Cargando…</div>}
      {view.name === 'setup' && <Setup svc={svc} onDone={async () => { await refresh(); setView({ name: 'home' }); runSync(); }} />}
      {view.name === 'blocked' && (
        <div className="screen">
          <div className="big">Teléfono bloqueado</div>
          <p className="muted">Este teléfono fue bloqueado o retirado por administración. Los datos de empleados se eliminaron del equipo.</p>
          <p className="muted" style={{ fontSize: 15 }}>Si fue un error: en el panel, Teléfonos → «Reactivar (emitir código)», y luego active este teléfono con ese código.</p>
          <button className="btn" onClick={async () => {
            const pending = counts?.pending ?? 0;
            const msg = pending > 0
              ? `Se borrarán ${pending} marcaciones que no se enviaron (el servidor ya no las aceptaría). ¿Activar de nuevo con un código?`
              : '¿Activar este teléfono de nuevo con un código del panel?';
            if (!window.confirm(msg)) return;
            await svc.resetForReactivation();
            await refresh();
            setView({ name: 'setup' });
          }}>Activar de nuevo con un código</button>
        </div>
      )}
      {view.name === 'home' && (
        <button className="screen full" style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit' }} onClick={() => {
          const cd = cooldownRemainingSec();
          if (cd > 0) { setView({ name: 'bio_fail', outcome: { kind: 'engine_error', message: `cooldown:${cd}` } }); return; }
          setView({ name: 'capture' });
        }} aria-label="Tocar para marcar asistencia">
          <h1>Marcar asistencia</h1>
          <div className="big">Toque la pantalla</div>
          <p className="muted">Mire a la cámara cuando se abra. No necesita escribir nada.</p>
        </button>
      )}
      {view.name === 'capture' && st && (
        <div className="screen" style={{ paddingTop: 84, justifyContent: 'flex-start' }}>
          <FaceCapture roster={roster} policy={st.policy} onDone={onCapture} />
          <p className="muted" style={{ fontSize: 15 }}>Centre su rostro en el óvalo, con buena luz. No necesita tocar nada.</p>
          <button className="btn small" onClick={() => setView({ name: 'home' })}>Cancelar</button>
        </div>
      )}
      {view.name === 'test_picker' && (
        <div className="screen" style={{ paddingTop: 84, justifyContent: 'flex-start' }}>
          <Camera />
          <p style={{ color: 'var(--warn)' }}>Enrolamiento facial pendiente en esta tienda: nadie tiene plantilla del motor real.</p>
          <p className="muted" style={{ fontSize: 14 }}>MODO PRUEBA (transitorio): seleccione la persona. Desaparece en cuanto exista un enrolamiento real.</p>
          <div className="picker">
            {roster.map((r) => <button key={r.employeeId} className="btn" onClick={() => punch(r.employeeId)}>{r.displayName}</button>)}
          </div>
          <button className="btn small" onClick={() => setView({ name: 'home' })}>Cancelar</button>
        </div>
      )}
      {view.name === 'bio_fail' && <BioFail o={view.outcome} onRetry={() => setView({ name: 'capture' })} onHome={() => setView({ name: 'home' })} />}
      {view.name === 'result' && <Result r={view.result} tz={st?.timezone ?? 'UTC'} />}
      {view.name === 'choose' && (
        <div className="screen full" role="alertdialog" aria-live="assertive" aria-label="Elegir tipo de salida" style={{ gap: 14 }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{firstNames(view.result.displayName)}</div>
          <p style={{ fontSize: 20, margin: 0 }}>Entró a las {fmtTime(view.result.inAtMs, st?.timezone ?? 'UTC')} · hace {fmtMin(view.result.minutesSince)}</p>
          {view.result.early && <p style={{ color: 'var(--warn)', fontSize: 18, margin: 0 }}>Entró hace muy poco. Si fue un error, toque «Cancelar».</p>}
          <p style={{ fontSize: 24, margin: '6px 0' }}>¿Qué desea registrar?</p>
          <button className="btn" style={{ background: '#f5a524', color: '#111', fontSize: 26, minHeight: 72 }} onClick={() => punch(view.employeeId, 'break')}>🍽 Salida a almuerzo</button>
          <button className="btn" style={{ background: 'var(--out)', color: '#fff', fontSize: 26, minHeight: 72 }} onClick={() => punch(view.employeeId, 'end')}>🏁 Salida — fin de turno</button>
          <button className="btn small" onClick={() => setView({ name: 'home' })}>Cancelar (no registrar nada)</button>
          <p className="muted" style={{ fontSize: 14 }}>Si no elige nada en 20 s, no se registra.</p>
        </div>
      )}
      {footer}
      {diag && <EngineDiagnostics onClose={() => setDiag(false)} />}
      {enroll && st && <Enrollment organizationId={st.organizationId} getTicket={() => svc.enrollTicket()} onClose={() => { setEnroll(false); runSync(); }} />}
      {admin && st && (
        <div className="overlay" role="dialog" aria-label="Estado del dispositivo">
          <h1>Estado del teléfono</h1>
          <table><tbody>
            <tr><td>Sede</td><td>{st.storeName}</td></tr>
            <tr><td>Última sincronización</td><td>{st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString('es', { timeZone: st.timezone }) : 'nunca'}</td></tr>
            <tr><td>Resultado</td><td>{syncInfo || '—'}</td></tr>
            <tr><td>Pendientes de subir</td><td>{counts?.pending ?? 0}</td></tr>
            <tr><td>Aceptados / revisión / rechazados</td><td>{counts?.accepted ?? 0} / {counts?.needs_review ?? 0} / {counts?.rejected ?? 0}</td></tr>
            <tr><td>Personas autorizadas</td><td>{roster.length}</td></tr>
            <tr><td>Política</td><td>v{st.policy.version}</td></tr>
            <tr><td>Motor biométrico</td><td>sface@2021dec + MiniFASNet + desafío activo (experimentales)</td></tr>
            <tr><td>Dispositivo</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{st.deviceId}</td></tr>
          </tbody></table>
          <button className="btn primary" onClick={runSync}>Sincronizar ahora</button>
          <button className="btn" onClick={() => { setAdmin(false); setDiag(true); }}>Diagnóstico del motor</button>
          {st.canEnroll
            ? <button className="btn" onClick={() => { setAdmin(false); setEnroll(true); }}>Enrolamiento (administrador)</button>
            : <p className="muted" style={{ fontSize: 14 }}>Este teléfono no tiene permiso de enrolamiento (se activa en el panel: Teléfonos → «Puede enrolar»; luego toque Sincronizar).</p>}
          <button className="btn small" onClick={() => setAdmin(false)}>Cerrar</button>
        </div>
      )}
    </>
  );
}

function Setup({ svc, onDone }: { svc: KioskService; onDone: () => void }) {
  const [signup, setSignup] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const MSG: Record<string, string> = {
    invalid_code: 'Código no válido, ya usado o caducado. Revise los 12 caracteres o emita uno nuevo en el panel.',
    network_error: 'Sin conexión. La activación requiere internet.', device_blocked: 'Dispositivo bloqueado.',
    throttled: 'Demasiados intentos. Espere unos minutos.', invalid_proof: 'Error de seguridad del teléfono. Reinstale la app.',
  };
  const onChange = (raw: string) => {
    const typed = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const n = normalizeCode(raw);
    setWarn(typed.length > n.length && /[O0I1L]/.test(typed) ? 'Los códigos no usan las letras O, I, L ni los números 0 y 1.' : null);
    setCode(n); setErr(null);
  };
  if (signup) return <OrgSignup onBack={() => setSignup(false)} />;
  return (
    <form className="screen" onSubmit={async (e) => { e.preventDefault(); if (code.length !== 12) return; setBusy(true); setErr(null); const r = await svc.activate(code); setBusy(false); r.ok ? onDone() : setErr(MSG[r.error] ?? r.error); }}>
      <h1>Activar teléfono de tienda</h1>
      <p className="muted">Introduzca el código emitido en el panel central (Dispositivos → Emitir código).</p>
      <input value={formatCode(code)} onChange={(e) => onChange(e.target.value)} placeholder="XXXX-XXXX-XXXX" inputMode="text"
        autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} aria-describedby="code-count" />
      <p id="code-count" className="muted" style={{ fontSize: 15, margin: 0 }}>{code.length} de 12 caracteres</p>
      {warn && <p style={{ color: 'var(--warn)', margin: 0 }}>{warn}</p>}
      {err && <p style={{ color: 'var(--err)' }}>{err}</p>}
      <button className="btn primary" disabled={busy || code.length !== 12}>{busy ? 'Activando…' : 'Activar'}</button>
      <hr style={{ width: 'min(420px, 90vw)', opacity: 0.3 }} />
      <p className="muted" style={{ margin: 0 }}>¿Su empresa aún no usa el sistema?</p>
      <button type="button" className="btn" onClick={() => setSignup(true)}>Crear mi organización</button>
    </form>
  );
}

function BioFail({ o, onRetry, onHome }: { o: CaptureOutcome; onRetry: () => void; onHome: () => void }) {
  useEffect(() => { const t = setTimeout(onHome, 15000); return () => clearTimeout(t); }, [onHome]);
  const MSG: Record<string, [string, string]> = {
    not_recognized: ['No reconocido', 'No se encontró coincidencia con el personal autorizado de esta tienda. Intente de nuevo con buena luz, mirando de frente.'],
    liveness_failed: ['Verificación no superada', 'No se pudo comprobar que hay una persona real frente a la cámara. Siga las indicaciones en pantalla e intente de nuevo.'],
    timeout: ['Tiempo agotado', 'No se logró una captura válida. Colóquese de frente, con buena luz, e intente de nuevo.'],
    ambiguous: ['Intente de nuevo', 'No fue posible distinguir con seguridad. Mire de frente y quédese quieto.'],
    uncalibrated: ['Reconocimiento sin calibrar', 'La administración aún no ha publicado los umbrales del motor. Avise al encargado.'],
    engine_error: ['Error del motor', 'No se pudo iniciar el reconocimiento. Avise al encargado.'],
  };
  const cooldown = o.kind === 'engine_error' && o.message.startsWith('cooldown:') ? o.message.split(':')[1] : null;
  const [t, d] = cooldown ? ['Espere un momento', `Demasiados intentos fallidos. Puede intentar de nuevo en ${cooldown} s.`] : MSG[o.kind] ?? ['No se registró', ''];
  return (
    <div className="screen full bad" role="alert">
      <div className="big">{t}</div>
      <p style={{ fontSize: 22 }}>{d}</p>
      <p>No se registró ninguna marcación. Si no puede ser reconocido, avise al encargado.</p>
      {o.kind === 'liveness_failed' && (
        <p className="muted" style={{ fontSize: 13 }}>Detalle técnico: {o.reason === 'passive' ? 'prueba pasiva' : o.reason === 'identity_changed' ? 'continuidad de identidad' : 'desafío no completado'}
          {o.score !== undefined && ` ${o.score.toFixed(2)} (mínimo ${o.threshold?.toFixed(2)})`}</p>
      )}
      {o.kind === 'not_recognized' && o.bestScore !== null && <p className="muted" style={{ fontSize: 13 }}>Detalle técnico: mejor similitud {o.bestScore.toFixed(2)}</p>}
      <button className="btn" onClick={onRetry}>Intentar de nuevo</button>
    </div>
  );
}

function Result({ r, tz }: { r: PunchResult; tz: string }) {
  if (r.kind === 'choose_out') return null; // se muestra en la pantalla de elección
  if (r.kind === 'recorded') {
    const name = firstNames(r.displayName);
    const anomalies = r.flags.filter((f) => !NORMAL_FLAGS.has(f));
    let title: string, line: string, extra: string | null = null;
    if (r.eventType === 'IN' && r.breakMinutes != null) {
      title = `¡${welcome(r.gender)} de nuevo, ${name}!`;
      line = `Regreso de almuerzo · ${fmtTime(r.at, tz)}`;
      extra = `Almuerzo: ${fmtMin(r.breakMinutes)}`;
    } else if (r.eventType === 'IN') {
      title = `¡${welcome(r.gender)}, ${name}!`;
      line = `Entrada registrada · ${fmtTime(r.at, tz)}`;
    } else if (r.outKind === 'break') {
      title = `¡Buen provecho, ${name}!`;
      line = `Salida a almuerzo · ${fmtTime(r.at, tz)}`;
      extra = 'Recuerde marcar al regresar.';
    } else {
      title = `¡Hasta pronto, ${name}!`;
      line = `Fin de turno · ${fmtTime(r.at, tz)}`;
      if (r.shift) extra = `Turno laborado: ${fmtMin(r.shift.workedMinutes)}` + (r.shift.breakMinutes ? ` · Almuerzo: ${fmtMin(r.shift.breakMinutes)}` : '')
        + (r.shift.complete ? '' : ' (según las marcaciones de este teléfono)');
    }
    return (
      <div className={`screen full ${r.eventType === 'IN' ? 'ok-in' : 'ok-out'}`} role="status" aria-live="assertive" style={{ gap: 10 }}>
        <div className="big" style={{ fontSize: 38 }}>{title}</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{line}</div>
        {extra && <div style={{ fontSize: 24 }}>{extra}</div>}
        <p style={{ fontSize: 15 }}>Guardado en el teléfono; se envía al servidor automáticamente.</p>
        {anomalies.length > 0 && <p style={{ fontSize: 14 }}>Hora en revisión ({anomalies.join(', ')})</p>}
      </div>
    );
  }
  if (r.kind === 'duplicate') {
    return (
      <div className="screen full warn" role="status" aria-live="assertive">
        <div className="big">Ya registrado</div>
        <div style={{ fontSize: 28 }}>{r.displayName}</div>
        <p>Su {r.eventType === 'IN' ? 'ENTRADA' : 'SALIDA'} se registró hace {r.secondsSince} s. No se registró nada nuevo.</p>
      </div>
    );
  }
  return (
    <div className="screen full bad" role="alert">
      <div className="big">No se registró</div>
      <p style={{ fontSize: 22 }}>{REFUSED[r.reason] ?? r.reason}</p>
      <p>Si no puede marcar, avise al encargado para el procedimiento supervisado.</p>
    </div>
  );
}
