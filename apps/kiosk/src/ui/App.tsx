import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { RosterEntry } from '@asistencia/core';
import { KioskService, nextBackoffMs, type PunchResult } from '../domain/kiosk.ts';
import type { DeviceState, LocalEventStatus } from '../domain/store.ts';
import { simulatedIdentification } from '../infra/biometric/engine.ts';
import { getEngine } from '../infra/biometric/index.ts';
import { Camera } from './Camera.tsx';
import { FaceCapture, type CaptureOutcome } from './FaceCapture.tsx';
import { EngineDiagnostics } from './EngineDiagnostics.tsx';

type View =
  | { name: 'loading' } | { name: 'setup' } | { name: 'home' } | { name: 'capture' }
  | { name: 'result'; result: PunchResult } | { name: 'blocked' } | { name: 'bio_fail'; outcome: CaptureOutcome } | { name: 'test_picker' }
  | { name: 'confirm'; employeeId: string; result: Extract<PunchResult, { kind: 'confirm_early_out' }> };

const fmtTime = (ms: number, tz: string) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz }).format(new Date(ms));
const REFUSED: Record<string, string> = {
  not_activated: 'Teléfono no activado.', blocked: 'Teléfono bloqueado por administración.',
  unknown_employee: 'Persona no autorizada en esta tienda.', lease_expired: 'Autorización caducada: el teléfono necesita sincronizar con internet.',
  offline_too_long: 'Demasiado tiempo sin conexión: conecte el teléfono a internet para seguir marcando.', storage_error: 'Error al guardar. Intente de nuevo; si persiste, avise al encargado.',
};

export function KioskApp({ svc, persistent }: { svc: KioskService; persistent: boolean }) {
  const [view, setView] = useState<View>({ name: 'loading' });
  const [st, setSt] = useState<DeviceState | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [counts, setCounts] = useState<Record<LocalEventStatus, number> | null>(null);
  const [syncInfo, setSyncInfo] = useState<string>('');
  const [admin, setAdmin] = useState(false);
  const [diag, setDiag] = useState(false);
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
    const t = setTimeout(() => setView({ name: 'home' }), (st?.policy.confirmationSec ?? 4) * 1000);
    return () => clearTimeout(t);
  }, [view, st]);
  useEffect(() => {
    if (view.name !== 'confirm') return;
    const t = setTimeout(() => setView({ name: 'home' }), 12_000); // sin respuesta: no se registra nada
    return () => clearTimeout(t);
  }, [view]);
  useEffect(() => {
    if (view.name !== 'capture') return;
    const t = setTimeout(() => setView({ name: 'home' }), 45_000); // inactividad
    return () => clearTimeout(t);
  }, [view]);

  const lastId = useRef<import('../domain/kiosk.ts').Identification | null>(null);
  const punchId = async (id: import('../domain/kiosk.ts').Identification, confirmEarlyOut = false) => {
    lastId.current = id;
    const result = await svc.punch(id, { confirmEarlyOut });
    if (result.kind === 'confirm_early_out') { setView({ name: 'confirm', employeeId: id.employeeId, result }); return; }
    setView({ name: 'result', result });
    refresh();
    if (result.kind === 'recorded') runSync();
  };
  const onCapture = (o: CaptureOutcome) => {
    if (o.kind === 'identified') return punchId(o.id);
    // Transición: si nadie de la tienda tiene plantillas del motor real (enrolamiento pendiente), se permite el modo prueba etiquetado.
    if (o.kind === 'no_templates') return setView({ name: 'test_picker' });
    setView({ name: 'bio_fail', outcome: o });
  };
  const punch = async (employeeId: string, confirmEarlyOut = false) => {
    if (confirmEarlyOut && lastId.current?.employeeId === employeeId) return punchId(lastId.current, true);
    const result = await svc.punch(simulatedIdentification(employeeId), { confirmEarlyOut });
    if (result.kind === 'confirm_early_out') { setView({ name: 'confirm', employeeId, result }); return; }
    setView({ name: 'result', result });
    refresh();
    if (result.kind === 'recorded') runSync();
  };

  const footer = st && (
    <div className="footer" onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => { const t = setTimeout(() => setAdmin(true), 3000); const up = () => { clearTimeout(t); e.currentTarget?.removeEventListener('pointerup', up); }; e.currentTarget.addEventListener('pointerup', up); }}>
      <span>{st.storeName}</span>
      <span>{counts?.pending ? `${counts.pending} pendientes` : 'al día'} · v{st.policy.version}</span>
    </div>
  );

  return (
    <>
      {view.name !== 'loading' && (
        <div className="banner-test">PRUEBA — reconocimiento experimental · sin prueba de vida · no apto para uso real</div>
      )}
      {!persistent && view.name !== 'loading' && <div className="banner-test" style={{ top: 32, background: '#e5484d', color: '#fff' }}>NAVEGADOR: datos no persistentes</div>}
      {view.name === 'loading' && <div className="screen muted">Cargando…</div>}
      {view.name === 'setup' && <Setup svc={svc} onDone={async () => { await refresh(); setView({ name: 'home' }); runSync(); }} />}
      {view.name === 'blocked' && (
        <div className="screen"><div className="big">Teléfono bloqueado</div><p className="muted">Este teléfono fue bloqueado o retirado por administración. Los datos de empleados se eliminaron del equipo.</p></div>
      )}
      {view.name === 'home' && (
        <button className="screen full" style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit' }} onClick={() => setView({ name: 'capture' })} aria-label="Tocar para marcar asistencia">
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
      {view.name === 'confirm' && (
        <div className="screen full warn" role="alertdialog" aria-live="assertive" aria-label="Confirmar salida">
          <div style={{ fontSize: 28 }}>{view.result.displayName}</div>
          <div className="big" style={{ fontSize: 34 }}>Entró hace {view.result.minutesSince < 1 ? 'menos de 1 minuto' : `${view.result.minutesSince} min`}</div>
          <p style={{ fontSize: 22, margin: 0 }}>(a las {fmtTime(view.result.inAtMs, st?.timezone ?? 'UTC')})</p>
          <p style={{ fontSize: 24 }}>¿Desea registrar su <b>SALIDA</b> ahora?</p>
          <button className="btn" style={{ background: 'var(--out)', color: '#fff', fontSize: 26 }} onClick={() => punch(view.employeeId, true)}>Sí, registrar SALIDA</button>
          <button className="btn" style={{ background: '#111', color: '#fff' }} onClick={() => setView({ name: 'home' })}>No, fue un error</button>
          <p style={{ fontSize: 14 }}>Si no responde, no se registra nada.</p>
        </div>
      )}
      {footer}
      {diag && <EngineDiagnostics onClose={() => setDiag(false)} />}
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
            <tr><td>Motor biométrico</td><td>sface@2021dec (experimental) · prueba de vida: no implementada</td></tr>
            <tr><td>Dispositivo</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{st.deviceId}</td></tr>
          </tbody></table>
          <button className="btn primary" onClick={runSync}>Sincronizar ahora</button>
          <button className="btn" onClick={() => { setAdmin(false); setDiag(true); }}>Diagnóstico del motor</button>
          <button className="btn small" onClick={() => setAdmin(false)}>Cerrar</button>
        </div>
      )}
    </>
  );
}

// Alfabeto de los códigos de activación (sin O, 0, I, 1, L para evitar confusiones).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizeCode(raw: string) {
  return raw.toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 12);
}
export const formatCode = (n: string) => n.replace(/(.{4})(?=.)/g, '$1-');

function Setup({ svc, onDone }: { svc: KioskService; onDone: () => void }) {
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
    </form>
  );
}

function BioFail({ o, onRetry, onHome }: { o: CaptureOutcome; onRetry: () => void; onHome: () => void }) {
  useEffect(() => { const t = setTimeout(onHome, 8000); return () => clearTimeout(t); }, [onHome]);
  const MSG: Record<string, [string, string]> = {
    not_recognized: ['No reconocido', 'No se encontró coincidencia con el personal autorizado de esta tienda. Intente de nuevo con buena luz, mirando de frente.'],
    ambiguous: ['Intente de nuevo', 'No fue posible distinguir con seguridad. Mire de frente y quédese quieto.'],
    uncalibrated: ['Reconocimiento sin calibrar', 'La administración aún no ha publicado los umbrales del motor. Avise al encargado.'],
    engine_error: ['Error del motor', 'No se pudo iniciar el reconocimiento. Avise al encargado.'],
  };
  const [t, d] = MSG[o.kind] ?? ['No se registró', ''];
  return (
    <div className="screen full bad" role="alert">
      <div className="big">{t}</div>
      <p style={{ fontSize: 22 }}>{d}</p>
      <p>No se registró ninguna marcación. Si no puede ser reconocido, avise al encargado.</p>
      <button className="btn" onClick={onRetry}>Intentar de nuevo</button>
    </div>
  );
}

function Result({ r, tz }: { r: PunchResult; tz: string }) {
  if (r.kind === 'confirm_early_out') return null; // se muestra en la pantalla de confirmación
  if (r.kind === 'recorded') {
    return (
      <div className={`screen full ${r.eventType === 'IN' ? 'ok-in' : 'ok-out'}`} role="status" aria-live="assertive">
        <div className="big">{r.eventType === 'IN' ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA'}</div>
        <div style={{ fontSize: 32 }}>{r.displayName}</div>
        <div style={{ fontSize: 40, fontWeight: 700 }}>{fmtTime(r.at, tz)}</div>
        <p>Guardado en el teléfono. Se enviará al servidor automáticamente.</p>
        {r.flags.length > 0 && <p style={{ fontSize: 14 }}>Hora en revisión ({r.flags.join(', ')})</p>}
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
