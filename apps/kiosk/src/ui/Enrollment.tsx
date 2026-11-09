import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActiveChallenge, getEngine, QUALITY_MESSAGE, FreeFaceRecognitionAdapter } from '../infra/biometric/index.ts';
import { poseFromFive } from '../infra/biometric/quality.ts';
import { createAdminClient } from '../infra/adminSession.ts';
import { Camera } from './Camera.tsx';

type Emp = { id: string; employee_code: string; first_name: string; last_name: string; status: string };
type Step =
  | { s: 'login' } | { s: 'mfa'; factorId: string } | { s: 'list' }
  | { s: 'prepare'; emp: Emp } | { s: 'capture'; emp: Emp; consentId: string | null; identity: string } | { s: 'done'; emp: Emp; message: string };

const DUP_THRESHOLD = 0.6; // provisional (Etapa 4 lo calibrará); se publica en docs/PRUEBAS_RECONOCIMIENTO.md
const PAD_ENROLL_MIN = 0.8; // provisional
const b64 = (v: Float32Array) => { let s = ''; for (const b of new Uint8Array(v.buffer)) s += String.fromCharCode(b); return btoa(s); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Modo enrolamiento (administrador): registro facial en la sede central de la organización del teléfono. Requiere internet. */
export function Enrollment({ organizationId, onClose, getTicket }: {
  organizationId: string; onClose: () => void;
  /** Autorización del teléfono (firmada con su clave); el servidor la exige para enrolar. */
  getTicket: () => Promise<{ ok: true; ticket: string } | { ok: false; error: string }>;
}) {
  const sb = useRef<SupabaseClient>(createAdminClient());
  const [step, setStep] = useState<Step>({ s: 'login' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  /** Tras iniciar sesión con MFA: liga la autorización del teléfono a la sesión del administrador. */
  const authorize = async () => {
    setErr(null);
    const t = await getTicket();
    if (!t.ok) {
      return setErr(t.error === 'enroll_not_allowed'
        ? 'Este teléfono no tiene permiso para enrolar. Actívelo en el panel: Teléfonos → «Puede enrolar».'
        : 'No se pudo obtener la autorización del teléfono (' + t.error + '). Revise la conexión.');
    }
    const { data, error } = await sb.current.rpc('bind_enroll_ticket', { p_ticket: t.ticket });
    if (error) return setErr(error.message);
    setDeviceLabel(String(data ?? ''));
    setStep({ s: 'list' });
  };
  const close = async () => { await sb.current.auth.signOut({ scope: 'local' }).catch(() => {}); onClose(); };

  return (
    <div className="overlay" style={{ justifyContent: 'flex-start', paddingTop: 40, overflowY: 'auto', textAlign: 'center' }}>
      <h1>Enrolamiento facial</h1>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Solo administradores. Motor EXPERIMENTAL (sface@2021dec + MiniFASNet). Requiere internet.</p>
      {err && <p style={{ color: 'var(--err)' }}>{err}</p>}
      {step.s === 'login' && <Login sb={sb.current} busy={busy} setBusy={setBusy} setErr={setErr} onOk={(factorId) => (factorId ? setStep({ s: 'mfa', factorId }) : void authorize())} />}
      {step.s === 'mfa' && <Mfa sb={sb.current} factorId={step.factorId} setErr={setErr} onOk={() => void authorize()} />}
      {deviceLabel && step.s !== 'login' && step.s !== 'mfa' && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Teléfono autorizado: {deviceLabel}</p>}
      {step.s === 'list' && <EmployeeList sb={sb.current} org={organizationId} setErr={setErr} onPick={(emp) => setStep({ s: 'prepare', emp })} />}
      {step.s === 'prepare' && <Prepare sb={sb.current} org={organizationId} emp={step.emp} setErr={setErr} onBack={() => setStep({ s: 'list' })}
        onReady={(consentId, identity) => setStep({ s: 'capture', emp: step.emp, consentId, identity })} />}
      {step.s === 'capture' && <Capture sb={sb.current} org={organizationId} emp={step.emp} consentId={step.consentId} identity={step.identity} setErr={setErr}
        onDone={(message) => setStep({ s: 'done', emp: step.emp, message })} onBack={() => setStep({ s: 'list' })} />}
      {step.s === 'done' && (
        <>
          <p style={{ fontSize: 22 }}>{step.message}</p>
          <button className="btn primary" onClick={() => { setErr(null); setStep({ s: 'list' }); }}>Enrolar a otra persona</button>
        </>
      )}
      <button className="btn small" style={{ marginTop: 16 }} onClick={close}>Salir del modo enrolamiento</button>
    </div>
  );
}

function Login({ sb, busy, setBusy, setErr, onOk }: { sb: SupabaseClient; busy: boolean; setBusy: (b: boolean) => void; setErr: (e: string | null) => void; onOk: (factorId: string | null) => void }) {
  // Campos NO controlados: evita conflictos con el teclado (sugerencias, autocompletado) en la WebView de Android.
  return (
    <form style={{ display: 'grid', gap: 10, width: 'min(420px, 92vw)' }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email') ?? '').replace(/\s+/g, '').toLowerCase();
      const password = String(fd.get('password') ?? '');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setBusy(false); return setErr('Credenciales inválidas o sin conexión.'); }
      const { data } = await sb.auth.mfa.listFactors();
      setBusy(false);
      const f = data?.totp.find((x) => x.status === 'verified');
      if (!f) return setErr('Su cuenta no tiene verificación en dos pasos. Configúrela primero en el panel web.');
      onOk(f.id);
    }}>
      <input name="email" type="email" inputMode="email" className="plain" placeholder="correo del administrador" required
        autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <input name="password" type="password" className="plain" placeholder="contraseña" required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}

function Mfa({ sb, factorId, setErr, onOk }: { sb: SupabaseClient; factorId: string; setErr: (e: string | null) => void; onOk: () => void }) {
  return (
    <form style={{ display: 'grid', gap: 10 }} onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\D/g, '');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) return setErr('Código incorrecto o caducado.');
      onOk();
    }}>
      <p>Código de su app de autenticación</p>
      <input name="code" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} required autoComplete="one-time-code" autoCorrect="off" spellCheck={false} />
      <button className="btn primary">Verificar</button>
    </form>
  );
}

function EmployeeList({ sb, org, setErr, onPick }: { sb: SupabaseClient; org: string; setErr: (e: string | null) => void; onPick: (e: Emp) => void }) {
  const [list, setList] = useState<(Emp & { enrolled: boolean })[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    (async () => {
      const [{ data, error }, { data: enr }, { data: model }] = await Promise.all([
        sb.from('employees').select('id, employee_code, first_name, last_name, status').eq('organization_id', org).eq('status', 'active').order('last_name'),
        sb.from('biometric_enrollments').select('employee_id, recognition_model_id').eq('organization_id', org).eq('status', 'active'),
        sb.from('model_versions').select('id').eq('name', 'sface').eq('version', '2021dec').maybeSingle(),
      ]);
      if (error) return setErr('No se pudo cargar la lista (¿permisos o conexión?).');
      const real = new Set((enr ?? []).filter((x) => x.recognition_model_id === model?.id).map((x) => x.employee_id));
      setList((data ?? []).map((e) => ({ ...e, enrolled: real.has(e.id) })));
    })();
  }, [sb, org, setErr]);
  if (!list) return <p>Cargando…</p>;
  const f = list.filter((e) => `${e.employee_code} ${e.first_name} ${e.last_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ width: 'min(480px, 94vw)', display: 'grid', gap: 8 }}>
      <input placeholder="buscar nombre o código" className="plain" autoCorrect="off" autoCapitalize="none" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
      {f.map((e) => (
        <button key={e.id} className="btn" style={{ textAlign: 'left', fontSize: 18 }} onClick={() => onPick(e)}>
          {e.last_name}, {e.first_name} <span className="muted">#{e.employee_code}</span> {e.enrolled ? '✅ enrolado' : '⏳ pendiente'}
        </button>
      ))}
      {f.length === 0 && <p className="muted">Sin empleados activos.</p>}
    </div>
  );
}

function Prepare({ sb, emp, setErr, onBack, onReady }: { sb: SupabaseClient; org: string; emp: Emp; setErr: (e: string | null) => void; onBack: () => void; onReady: (consentId: string | null, identity: string) => void }) {
  const [docChecked, setDocChecked] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ width: 'min(480px, 94vw)', display: 'grid', gap: 10, textAlign: 'left' }}>
      <h2 style={{ margin: 0 }}>{emp.first_name} {emp.last_name} <span className="muted">#{emp.employee_code}</span></h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={docChecked} onChange={(e) => setDocChecked(e.target.checked)} />
        Verifiqué su identidad con el documento original.</label>
      <label style={{ display: 'grid', gap: 4 }}>Número de documento del empleado (se compara con el registrado):
        <input ref={docRef} name="doc" className="plain" placeholder="Escriba el número del documento original" inputMode="text"
          autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      </label>
      <button className="btn primary" disabled={busy || !docChecked} onClick={async () => {
        setErr(null);
        const doc = (docRef.current?.value ?? '').replace(/[^A-Za-z0-9]/g, '');
        if (doc.length < 5) return setErr('Escriba el número de documento del empleado.');
        setBusy(true);
        const { data: v, error: vErr } = await sb.rpc('verify_employee_document', { p_employee_id: emp.id, p_document_number: doc });
        setBusy(false);
        if (vErr) return setErr('No se pudo verificar el documento: ' + vErr.message);
        const ver = v as { ok: boolean; message?: string };
        if (!ver.ok) { if (docRef.current) docRef.current.value = ''; return setErr(ver.message ?? 'El documento no coincide.'); }
        onReady(null, 'Documento original revisado en persona; número coincide con el registrado');
      }}>Continuar a la captura</button>
      <button className="btn small" onClick={onBack}>Volver</button>
    </div>
  );
}

const dot = (a: Float32Array, b: Float32Array) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]! * b[i]!; return t; };
const MIN_CONSISTENCY = 0.5; // similitud mínima de cada muestra frontal con el promedio (provisional, Etapa 4)
const MIN_POSE_SIM = 0.25;   // las muestras de perfil deben parecerse a la frontal (misma persona); provisional
const STEP_TIMEOUT_MS = 20_000;
const YAW_DELTA = 0.08, PITCH_DELTA = 0.05;

type Cand = { emb: Float32Array; pad: number; q: unknown };
/** Elige las `k` muestras más coherentes entre sí (descarta fotogramas atípicos: movimiento, parpadeo, mala alineación). */
function mostConsistent(c: Cand[], k: number) {
  const score = c.map((x, i) => c.reduce((acc, y, j) => (i === j ? acc : acc + dot(x.emb, y.emb)), 0));
  const picked = c.map((x, i) => ({ x, s: score[i]! })).sort((a, b) => b.s - a.s).slice(0, k).map((p) => p.x);
  const mean = FreeFaceRecognitionAdapter.average(picked.map((p) => p.emb));
  const sims = picked.map((p) => dot(p.emb, mean));
  return { picked, mean, sims, minSim: Math.min(...sims) };
}

/** Pasos del registro facial guiado (primer enrolamiento). */
const STEPS = [
  { key: 'front', icon: '🙂', text: 'Mire de frente a la cámara' },
  { key: 'left', icon: '⬅️', text: 'Gire un poco la cabeza a su izquierda' },
  { key: 'right', icon: '➡️', text: 'Ahora gire un poco a su derecha' },
  { key: 'up', icon: '⬆️', text: 'Levante un poco la barbilla (mire arriba)' },
  { key: 'down', icon: '⬇️', text: 'Baje un poco la barbilla (mire abajo)' },
  { key: 'blink', icon: '😉', text: 'Mire de frente y parpadee' },
] as const;

function Capture({ sb, org, emp, consentId, identity, setErr, onDone, onBack }: {
  sb: SupabaseClient; org: string; emp: Emp; consentId: string | null; identity: string; setErr: (e: string | null) => void; onDone: (m: string) => void; onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [hint, setHint] = useState('Preparando cámara…');
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState<number[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stop = false;
    setFailed(null); setDone([]); setStep(-1); setErr(null);
    const fail = (m: string) => { if (!stop) { setFailed(m); setHint('Captura no completada'); } };
    (async () => {
      setHint('Cargando motor…');
      const eng = await getEngine();
      const frontal: Cand[] = []; const poses: Cand[] = [];
      let baseYaw = 0.5, basePitch = 0.55, upSign = 0, leftSign = 0;

      /** Toma una muestra cuando `ok(pose)` se cumple (calidad suficiente salvo la exigencia de mirar de frente). */
      const grab = async (accept: (p: ReturnType<typeof poseFromFive>) => boolean, frontalOnly: boolean): Promise<Cand | null> => {
        const t0 = performance.now();
        while (!stop && performance.now() - t0 < STEP_TIMEOUT_MS) {
          await sleep(60); // ceder el hilo: repintado y fotograma nuevo
          const v = video.current; if (!v || v.readyState < 2) continue;
          const a = await eng.analyze(v, performance.now());
          const issues = a.quality.issues.filter((i) => frontalOnly || i !== 'not_frontal');
          if (!a.aligned || a.faces.length !== 1 || issues.length) { if (issues[0]) setHint(QUALITY_MESSAGE[issues[0]]); continue; }
          const pose = poseFromFive(a.faces[0]!);
          if (!accept(pose)) continue;
          return { emb: await eng.embed(a.aligned), pad: frontalOnly ? await eng.liveness.score(v, a.faces[0]!) : 0, q: a.quality.metrics };
        }
        return null;
      };

      for (let i = 0; i < STEPS.length && !stop; i++) {
        const st = STEPS[i]!;
        setStep(i); setHint(`${st.icon} ${st.text}`);
        if (st.key === 'front') {
          for (let n = 0; n < 4 && !stop; n++) {
            const c = await grab(() => true, true);
            if (!c) return fail('No se logró una imagen de frente en 20 s. Mejore la luz, acérquese y mire de frente.');
            frontal.push(c); await sleep(450);
          }
          const m = frontal.map((f) => (f.q as { yawRatio: number; pitchRatio: number }));
          baseYaw = m.reduce((x, y) => x + y.yawRatio, 0) / m.length; basePitch = m.reduce((x, y) => x + y.pitchRatio, 0) / m.length;
        } else if (st.key === 'left' || st.key === 'right') {
          const c = await grab((p) => {
            const d = p.yawRatio - baseYaw;
            if (Math.abs(d) < YAW_DELTA) return false;
            if (st.key === 'left') { leftSign = Math.sign(d); return true; }
            return Math.sign(d) === -leftSign; // derecha = sentido contrario al registrado como izquierda
          }, false);
          if (!c) return fail(`No se detectó el giro (${st.text.toLowerCase()}). Gire un poco más la cabeza, sin salir de la imagen.`);
          poses.push(c);
        } else if (st.key === 'up' || st.key === 'down') {
          const c = await grab((p) => {
            const d = p.pitchRatio - basePitch;
            if (Math.abs(d) < PITCH_DELTA) return false;
            if (st.key === 'up') { upSign = Math.sign(d); return true; }
            return Math.sign(d) === -upSign;
          }, false);
          if (!c) return fail(`No se detectó el movimiento (${st.text.toLowerCase()}). Mueva un poco más la cabeza.`);
          poses.push(c);
        } else {
          // Vuelta al frente + parpadeo (prueba de vida activa) + muestras frontales finales.
          const ch = new ActiveChallenge('blink');
          const t0 = performance.now(); let ok = false;
          while (!stop && performance.now() - t0 < STEP_TIMEOUT_MS) {
            await sleep(30);
            const v = video.current; if (!v || v.readyState < 2) continue;
            const f = await eng.detector.detect(v, performance.now());
            if (f.length === 1 && ch.update(f[0]!)) { ok = true; break; }
          }
          if (!ok) return fail('No se detectó el parpadeo. Mire de frente y parpadee con normalidad.');
          setHint('✅ Bien. Quédese quieto mirando de frente');
          await sleep(900);
          for (let n = 0; n < 3 && !stop; n++) {
            const c = await grab(() => true, true);
            if (!c) return fail('No se logró la imagen final de frente. Mejore la luz e intente de nuevo.');
            frontal.push(c); await sleep(400);
          }
        }
        setDone((d) => [...d, i]);
      }
      if (stop) return;
      setStep(STEPS.length); setHint('Revisando calidad…');
      const { picked, mean, sims, minSim } = mostConsistent(frontal, 5);
      if (minSim < MIN_CONSISTENCY) {
        return fail(`Las imágenes de frente no son consistentes (mínima ${minSim.toFixed(2)}, se requiere ${MIN_CONSISTENCY}; valores: ${sims.map((x) => x.toFixed(2)).join(', ')}). Evite moverse y mejore la luz.`);
      }
      const poseSims = poses.map((p) => dot(p.emb, mean));
      if (Math.min(...poseSims) < MIN_POSE_SIM) {
        return fail(`Las imágenes de perfil no coinciden con la de frente (${poseSims.map((x) => x.toFixed(2)).join(', ')}). Repita sin salir de la imagen y sin que aparezca otra persona.`);
      }
      const pad = picked.reduce((x, y) => x + y.pad, 0) / picked.length;
      if (pad < PAD_ENROLL_MIN) return fail(`Prueba de vida pasiva insuficiente (${pad.toFixed(2)}, se requiere ${PAD_ENROLL_MIN}). Mejore la luz (de frente, sin contraluz) e intente de nuevo.`);
      const samples = [...picked, ...poses];
      setHint('Comprobando duplicados…');
      const { data: model } = await sb.from('model_versions').select('id').eq('name', 'sface').eq('version', '2021dec').single();
      const enc = samples.map((p) => b64(p.emb));
      const { data: dups, error: dErr } = await sb.rpc('check_biometric_duplicate', { p_employee_id: emp.id, p_samples: enc, p_recognition_model_id: model!.id, p_threshold: DUP_THRESHOLD });
      if (dErr) return fail('Error al comprobar duplicados: ' + dErr.message);
      if ((dups as unknown[]).length) {
        const d = (dups as { employee_code: string; employee_name: string; score: number }[])[0]!;
        return fail(`Este rostro ya está enrolado como ${d.employee_name} (#${d.employee_code}, similitud ${d.score.toFixed(2)}). Enrolamiento bloqueado; revise con administración.`);
      }
      const { data: central } = await sb.rpc('central_store_for', { p_org: org });
      if (!central) return fail('La organización no tiene una sede central activa. Márquela en el panel (Sedes y tiendas).');
      const { data: padModel } = await sb.from('model_versions').select('id').eq('kind', 'pad').eq('name', 'minifasnet-v2+v1se').maybeSingle();
      setHint('Guardando…');
      const { error } = await sb.rpc('enroll_biometric', {
        p_employee_id: emp.id, p_consent_id: consentId, p_store_id: central, p_identity_method: identity, p_samples: enc,
        p_quality: { frontal: picked.map((p) => p.q), poses: poses.map((p) => p.q), minConsistency: +minSim.toFixed(3), poseSims: poseSims.map((x) => +x.toFixed(3)),
          engine: eng.label, guided: STEPS.map((x) => x.key) }, p_pad_passed: true, p_pad_score: pad,
        p_recognition_model_id: model!.id, p_pad_model_id: padModel?.id ?? null,
      });
      if (error) return fail('No se pudo guardar: ' + error.message);
      onDone(`✅ ${emp.first_name} ${emp.last_name} enrolado (${samples.length} muestras: frente, izquierda, derecha, arriba, abajo; consistencia ${minSim.toFixed(2)}, prueba de vida ${pad.toFixed(2)}). Los teléfonos de su tienda lo recibirán en la próxima sincronización.`);
    })().catch((e) => fail('Error del motor: ' + (e instanceof Error ? e.message : String(e))));
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return (
    <>
      <p style={{ fontSize: 20, margin: 0 }}>{emp.first_name} {emp.last_name}</p>
      <Camera onVideo={(v) => { video.current = v; }} />
      <p style={{ fontSize: 26, fontWeight: 800, margin: 0, color: step >= 0 && step < STEPS.length ? 'var(--warn)' : undefined }}>{hint}</p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }} aria-label="Progreso del registro">
        {STEPS.map((st, i) => (
          <span key={st.key} title={st.text} style={{ fontSize: 22, padding: '4px 8px', borderRadius: 10,
            background: done.includes(i) ? 'var(--ok, #1f9d55)' : i === step ? '#f5a524' : 'rgba(127,127,127,.25)' }}>{done.includes(i) ? '✓' : st.icon}</span>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>Paso {Math.min(step + 1, STEPS.length)} de {STEPS.length}</p>
      {failed && <p style={{ color: 'var(--err)', fontSize: 16 }}>{failed}</p>}
      {failed && <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Reintentar registro</button>}
      <button className="btn small" onClick={onBack}>{failed ? 'Volver' : 'Cancelar'}</button>
    </>
  );
}
