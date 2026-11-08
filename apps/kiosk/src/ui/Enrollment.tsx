import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ActiveChallenge, CHALLENGE_TEXT, getEngine, QUALITY_MESSAGE, randomChallenge, FreeFaceRecognitionAdapter } from '../infra/biometric/index.ts';
import { createAdminClient } from '../infra/adminSession.ts';
import { Camera } from './Camera.tsx';

type Emp = { id: string; employee_code: string; first_name: string; last_name: string; status: string };
type Step =
  | { s: 'login' } | { s: 'mfa'; factorId: string } | { s: 'list' }
  | { s: 'prepare'; emp: Emp } | { s: 'capture'; emp: Emp; consentId: string; identity: string } | { s: 'done'; emp: Emp; message: string };

const SAMPLES = 5;
const DUP_THRESHOLD = 0.6; // provisional (Etapa 4 lo calibrará); se publica en docs/PRUEBAS_RECONOCIMIENTO.md
const PAD_ENROLL_MIN = 0.8; // provisional
const b64 = (v: Float32Array) => { let s = ''; for (const b of new Uint8Array(v.buffer)) s += String.fromCharCode(b); return btoa(s); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Modo enrolamiento (administrador): registro facial en la sede central de la organización del teléfono. Requiere internet. */
export function Enrollment({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const sb = useRef<SupabaseClient>(createAdminClient());
  const [step, setStep] = useState<Step>({ s: 'login' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = async () => { await sb.current.auth.signOut().catch(() => {}); onClose(); };

  return (
    <div className="overlay" style={{ justifyContent: 'flex-start', paddingTop: 40, overflowY: 'auto', textAlign: 'center' }}>
      <h1>Enrolamiento facial</h1>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Solo administradores. Motor EXPERIMENTAL (sface@2021dec + MiniFASNet). Requiere internet.</p>
      {err && <p style={{ color: 'var(--err)' }}>{err}</p>}
      {step.s === 'login' && <Login sb={sb.current} busy={busy} setBusy={setBusy} setErr={setErr} onOk={(factorId) => setStep(factorId ? { s: 'mfa', factorId } : { s: 'list' })} />}
      {step.s === 'mfa' && <Mfa sb={sb.current} factorId={step.factorId} setErr={setErr} onOk={() => setStep({ s: 'list' })} />}
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

function Prepare({ sb, org, emp, setErr, onBack, onReady }: { sb: SupabaseClient; org: string; emp: Emp; setErr: (e: string | null) => void; onBack: () => void; onReady: (consentId: string, identity: string) => void }) {
  const [consentId, setConsentId] = useState<string | null | undefined>(undefined);
  const [signed, setSigned] = useState(false); const [docChecked, setDocChecked] = useState(false);
  const [method, setMethod] = useState('Documento de identidad presentado y verificado en persona');
  useEffect(() => {
    sb.from('biometric_consents').select('id').eq('employee_id', emp.id).is('withdrawn_at', null).order('accepted_at', { ascending: false }).limit(1)
      .then(({ data }) => setConsentId(data?.[0]?.id ?? null));
  }, [sb, emp.id]);
  if (consentId === undefined) return <p>Cargando…</p>;
  return (
    <div style={{ width: 'min(480px, 94vw)', display: 'grid', gap: 10, textAlign: 'left' }}>
      <h2 style={{ margin: 0 }}>{emp.first_name} {emp.last_name} <span className="muted">#{emp.employee_code}</span></h2>
      {consentId ? <p>✅ Consentimiento biométrico vigente registrado.</p> : (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={signed} onChange={(e) => setSigned(e.target.checked)} />
          La persona firmó el consentimiento para el uso de su rostro en el control de asistencia.</label>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={docChecked} onChange={(e) => setDocChecked(e.target.checked)} />
        Verifiqué su identidad con el documento original.</label>
      <input defaultValue={method} onBlur={(e) => setMethod(e.target.value)} className="plain" autoCorrect="off" spellCheck={false} />
      <button className="btn primary" disabled={!docChecked || (!consentId && !signed)} onClick={async () => {
        setErr(null);
        let cid = consentId;
        if (!cid) {
          const { data: u } = await sb.auth.getUser();
          const { data, error } = await sb.from('biometric_consents').insert({ organization_id: org, employee_id: emp.id, legal_basis: 'consentimiento_expreso',
            notice_version: 'v1', accepted_at: new Date().toISOString(), evidence_ref: 'Firmado en sede central (registrado en app)', recorded_by: u.user?.id }).select('id').single();
          if (error || !data) return setErr('No se pudo registrar el consentimiento: ' + (error?.message ?? ''));
          cid = data.id;
        }
        onReady(cid!, method);
      }}>Continuar a la captura</button>
      <button className="btn small" onClick={onBack}>Volver</button>
    </div>
  );
}

const dot = (a: Float32Array, b: Float32Array) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]! * b[i]!; return t; };
const MAX_CANDIDATES = 10;   // fotogramas válidos que se intentan como máximo
const MIN_CONSISTENCY = 0.5; // similitud mínima de cada muestra con el promedio (provisional, Etapa 4)

/** Elige las `k` muestras más coherentes entre sí (descarta fotogramas atípicos: movimiento, parpadeo, mala alineación). */
function mostConsistent(c: { emb: Float32Array; pad: number; q: unknown }[], k: number) {
  const score = c.map((x, i) => c.reduce((acc, y, j) => (i === j ? acc : acc + dot(x.emb, y.emb)), 0));
  const picked = c.map((x, i) => ({ x, s: score[i]! })).sort((a, b) => b.s - a.s).slice(0, k).map((p) => p.x);
  const mean = FreeFaceRecognitionAdapter.average(picked.map((p) => p.emb));
  const sims = picked.map((p) => dot(p.emb, mean));
  return { picked, mean, sims, minSim: Math.min(...sims) };
}

function Capture({ sb, org, emp, consentId, identity, setErr, onDone, onBack }: {
  sb: SupabaseClient; org: string; emp: Emp; consentId: string; identity: string; setErr: (e: string | null) => void; onDone: (m: string) => void; onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [hint, setHint] = useState('Preparando cámara…');
  const [count, setCount] = useState(0);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stop = false;
    setFailed(null); setCount(0); setErr(null);
    const fail = (m: string) => { if (!stop) { setFailed(m); setHint('Captura no completada'); setChallenge(null); } };
    (async () => {
      setHint('Cargando motor…');
      const eng = await getEngine();
      // 1) Prueba de vida activa antes de capturar.
      const ch = new ActiveChallenge(randomChallenge());
      setHint('Prueba de vida'); setChallenge(CHALLENGE_TEXT[ch.kind]);
      const t0 = performance.now(); let ok = false;
      while (!stop && performance.now() - t0 < 15000) {
        const v = video.current; if (!v || v.readyState < 2) { await sleep(100); continue; }
        const f = await eng.detector.detect(v, performance.now());
        if (f.length === 1 && ch.update(f[0]!)) { ok = true; break; }
        await sleep(30);
      }
      setChallenge(null);
      if (stop) return;
      if (!ok) return fail('No se completó la prueba de vida en 15 s. Siga la instrucción en pantalla (parpadear o girar la cabeza).');
      // 2) Pausa: que la persona vuelva a mirar de frente antes de tomar muestras.
      setHint('✅ Bien. Ahora mire de frente y quédese quieto');
      await sleep(1800);
      // 3) Muestras espaciadas; se guardan hasta MAX_CANDIDATES y se eligen las más coherentes.
      const cand: { emb: Float32Array; pad: number; q: unknown }[] = [];
      const tStart = performance.now();
      while (!stop && cand.length < MAX_CANDIDATES && performance.now() - tStart < 30000) {
        const v = video.current; if (!v || v.readyState < 2) { await sleep(100); continue; }
        const a = await eng.analyze(v, performance.now());
        if (!a.quality.ok || !a.aligned) { setHint(QUALITY_MESSAGE[a.quality.issues[0]!]); await sleep(120); continue; }
        const emb = await eng.embed(a.aligned);
        const pad = await eng.liveness.score(v, a.faces[0]!);
        cand.push({ emb, pad, q: a.quality.metrics });
        if (cand.length >= SAMPLES && mostConsistent(cand, SAMPLES).minSim >= MIN_CONSISTENCY) break;
        setCount(Math.min(cand.length, SAMPLES)); setHint(cand.length < SAMPLES ? 'Muestra guardada, siga mirando de frente' : 'Tomando una muestra más…');
        await sleep(600);
      }
      if (stop) return;
      if (cand.length < SAMPLES) return fail(`Solo se lograron ${cand.length} de ${SAMPLES} muestras en 30 s. Mejore la luz, acérquese y mire de frente.`);
      const { picked, sims, minSim } = mostConsistent(cand, SAMPLES);
      setCount(SAMPLES);
      if (minSim < MIN_CONSISTENCY) {
        return fail(`Las muestras no son consistentes (mínima ${minSim.toFixed(2)}, se requiere ${MIN_CONSISTENCY}; valores: ${sims.map((x) => x.toFixed(2)).join(', ')}; fotogramas probados: ${cand.length}). Evite moverse y mejore la luz.`);
      }
      const pad = picked.reduce((x, y) => x + y.pad, 0) / picked.length;
      if (pad < PAD_ENROLL_MIN) return fail(`Prueba de vida pasiva insuficiente (${pad.toFixed(2)}, se requiere ${PAD_ENROLL_MIN}). Mejore la luz (de frente, sin contraluz) e intente de nuevo.`);
      setHint('Comprobando duplicados…');
      const { data: model } = await sb.from('model_versions').select('id').eq('name', 'sface').eq('version', '2021dec').single();
      const enc = picked.map((p) => b64(p.emb));
      const quality = picked.map((p) => p.q);
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
        p_quality: { samples: quality, minConsistency: +minSim.toFixed(3), candidates: cand.length, engine: eng.label, challenge: ch.kind }, p_pad_passed: true, p_pad_score: pad,
        p_recognition_model_id: model!.id, p_pad_model_id: padModel?.id ?? null,
      });
      if (error) return fail('No se pudo guardar: ' + error.message);
      onDone(`✅ ${emp.first_name} ${emp.last_name} enrolado (${SAMPLES} muestras, consistencia ${minSim.toFixed(2)}, prueba de vida ${pad.toFixed(2)}). Los teléfonos de su tienda lo recibirán en la próxima sincronización.`);
    })().catch((e) => fail('Error del motor: ' + (e instanceof Error ? e.message : String(e))));
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return (
    <>
      <p style={{ fontSize: 20, margin: 0 }}>{emp.first_name} {emp.last_name}</p>
      <Camera onVideo={(v) => { video.current = v; }} />
      {challenge && <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--warn)', margin: 0 }}>{challenge}</p>}
      <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{hint}</p>
      <p>Muestras: {count} / {SAMPLES}</p>
      {failed && <p style={{ color: 'var(--err)', fontSize: 16 }}>{failed}</p>}
      {failed && <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Reintentar captura</button>}
      <button className="btn small" onClick={onBack}>{failed ? 'Volver' : 'Cancelar'}</button>
    </>
  );
}
