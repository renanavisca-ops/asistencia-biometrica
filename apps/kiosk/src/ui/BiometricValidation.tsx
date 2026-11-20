import { useEffect, useRef, useState } from 'react';
import { l2normalize, matchOneToN, type DevicePolicy, type RosterEntry } from '@asistencia/core';
import { challengeModeFromPolicy, getEngine, runCapture, type CaptureOutcome } from '../infra/biometric/index.ts';
import type { KioskService } from '../domain/kiosk.ts';
import type { BiometricTrial } from '../domain/store.ts';
import { APP_VERSION } from '../infra/platform.capacitor.ts';
import { Camera } from './Camera.tsx';

type Condition = BiometricTrial['condition'];
const CONDITIONS: [Condition, string][] = [
  ['genuine', 'Persona enrolada (debe reconocerse)'], ['impostor', 'Persona NO enrolada (debe rechazarse)'],
  ['attack_print', 'Ataque: foto impresa'], ['attack_screen', 'Ataque: foto en otra pantalla'],
  ['attack_video', 'Ataque: vídeo en otra pantalla'], ['attack_other', 'Ataque: otro (máscara, recorte…)'],
];
const OUTCOME: Record<string, string> = {
  identified: 'Reconocido', not_recognized: 'No reconocido', ambiguous: 'Dudoso (dos candidatos parecidos)', liveness_failed: 'Prueba de vida no superada',
  uncalibrated: 'Sin calibrar', no_templates: 'Sin plantillas en el teléfono', timeout: 'Tiempo agotado', engine_error: 'Error del motor',
};
const uuid = () => crypto.randomUUID();
const r3 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—');

async function deviceInfo(t0: number) {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  let battery: number | null = null, charging: boolean | null = null;
  try {
    const b = await (navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.();
    if (b) { battery = b.level; charging = b.charging; }
  } catch { /* sin API de batería */ }
  return { memoryMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null, battery, charging, sessionMin: Math.round((performance.now() - t0) / 60000),
    ua: navigator.userAgent.slice(0, 160), cores: navigator.hardwareConcurrency ?? null };
}

/**
 * Modo validación biométrica: misma cadena que la marcación (calidad, prueba de vida, embedding, 1:N) pero SIN registrar
 * asistencia. Cada intento guarda condición, puntuaciones, tiempos, memoria y batería (sin imágenes) y se envía al servidor
 * para calcular FAR/FRR/APCER/BPCER en el panel (Validación biométrica). Ver docs/RESULTADOS_PRUEBAS_BIOMETRICAS.md.
 */
export function BiometricValidation({ svc, roster, policy, onClose }: { svc: KioskService; roster: RosterEntry[]; policy: DevicePolicy; onClose: () => void }) {
  const session = useRef(uuid());
  const t0 = useRef(performance.now());
  const [cond, setCond] = useState<Condition>('genuine');
  const [expected, setExpected] = useState(roster[0]?.employeeId ?? '');
  const [lighting, setLighting] = useState<BiometricTrial['lighting']>('normal');
  const [accessories, setAccessories] = useState('');
  const [challenge, setChallenge] = useState<'none' | 'blink' | 'random'>(challengeModeFromPolicy(policy));
  const [running, setRunning] = useState(false);
  const [hint, setHint] = useState('');
  const [chText, setChText] = useState<string | null>(null);
  const [last, setLast] = useState<{ t: BiometricTrial; o: CaptureOutcome } | null>(null);
  const [done, setDone] = useState<BiometricTrial[]>([]);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const stop = useRef(false);
  const name = (id: string | null) => roster.find((r) => r.employeeId === id)?.displayName ?? (id ? 'otra persona' : '—');

  useEffect(() => { svc.store.getPendingTrials().then((l) => setPending(l.length)); return () => { stop.current = true; }; }, [svc]);

  const save = async (t: BiometricTrial) => {
    await svc.recordTrial(t);
    setDone((d) => [...d, t]);
    setPending((await svc.store.getPendingTrials()).length);
  };

  const base = async (condition: Condition): Promise<Omit<BiometricTrial, 'outcome' | 'outcomeReason' | 'identifiedEmployeeId' | 'metrics'>> => ({
    id: uuid(), sessionId: session.current, capturedAt: new Date().toISOString(), condition,
    expectedEmployeeId: condition === 'genuine' ? expected || null : null, lighting, accessories: accessories.trim() || null, challengeMode: challenge,
    thresholds: { match: policy.matchThreshold, margin: policy.matchMargin, pad: policy.padThreshold },
    device: await deviceInfo(t0.current), recognitionModel: null, padModel: null, appVersion: APP_VERSION, notes: null,
  });

  const attempt = async () => {
    setRunning(true); setLast(null); setMsg(null); stop.current = false;
    const eng = await getEngine();
    const r = await runCapture({ eng, video: () => video.current, roster, policy, challenge, stopped: () => stop.current, onHint: setHint, onChallenge: setChText });
    setRunning(false); setHint(''); setChText(null);
    const o = r.outcome;
    const t: BiometricTrial = { ...(await base(cond)), outcome: o.kind,
      outcomeReason: o.kind === 'liveness_failed' ? o.reason : o.kind === 'timeout' ? o.stage ?? null : o.kind === 'engine_error' ? o.message.slice(0, 80) : null,
      identifiedEmployeeId: o.kind === 'identified' ? o.id.employeeId : null, metrics: { ...r.metrics },
      recognitionModel: eng.modelVersion, padModel: `${eng.padModel}+${challenge}` };
    await save(t);
    setLast({ t, o });
  };

  /** Rendimiento 1:N en ESTE teléfono con galerías sintéticas (vectores aleatorios del mismo tamaño que SFace). */
  const benchmark = async () => {
    setMsg('Midiendo 1:N…'); await new Promise((r) => setTimeout(r, 50));
    const eng = await getEngine();
    const dims = eng.recognizer.dims, rows: Record<string, number> = {};
    const rnd = () => { const v = new Float32Array(dims); for (let i = 0; i < dims; i++) v[i] = Math.random() * 2 - 1; return l2normalize(v); };
    for (const n of [10, 100, 500, 1000, 5000]) {
      const gallery = Array.from({ length: n }, (_, i) => ({ employeeId: String(i), modelVersion: eng.modelVersion, templates: [rnd(), rnd(), rnd()] }));
      const probe = rnd(), runs = 20, ts = performance.now();
      for (let k = 0; k < runs; k++) matchOneToN({ probe, probeModelVersion: eng.modelVersion, gallery, threshold: 0.5, minMargin: 0.05 });
      rows[`n${n}`] = Math.round(((performance.now() - ts) / runs) * 100) / 100;
    }
    const t: BiometricTrial = { ...(await base('benchmark')), outcome: 'benchmark', outcomeReason: null, identifiedEmployeeId: null,
      metrics: { templatesPerEmployee: 3 }, benchmark: { msByGallerySize: rows, dims }, recognitionModel: eng.modelVersion, padModel: null };
    await save(t);
    setMsg(`1:N (ms por búsqueda, 3 plantillas c/u): ${Object.entries(rows).map(([k, v]) => `${k.slice(1)} → ${v}`).join(' · ')}`);
  };

  const send = async () => {
    setMsg('Enviando…');
    const r = await svc.sendTrials();
    setPending(r.pending);
    setMsg(r.ok ? `Enviados ${r.sent} intentos. Véalos en el panel: Validación biométrica.` : `No se pudo enviar (${r.error}); quedan ${r.pending} guardados en el teléfono.`);
  };

  const count = (c: Condition) => done.filter((t) => t.condition === c).length;
  const sel = { fontSize: 16, padding: 8, width: '100%' } as const;
  return (
    <div className="overlay" style={{ alignItems: 'stretch', gap: 8, overflowY: 'auto' }}>
      <h1 style={{ margin: 0 }}>Validación biométrica</h1>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>No registra asistencia. Guarda puntuaciones y tiempos (sin fotos) para medir aciertos, errores y ataques.
        Use solo personas que hayan aceptado participar.</p>
      {!running && (
        <>
          <label>Condición<select style={sel} value={cond} onChange={(e) => setCond(e.target.value as Condition)}>
            {CONDITIONS.map(([k, v]) => <option key={k} value={k}>{v} ({count(k)})</option>)}</select></label>
          {cond === 'genuine' && <label>¿Quién está frente a la cámara?<select style={sel} value={expected} onChange={(e) => setExpected(e.target.value)}>
            {roster.map((r) => <option key={r.employeeId} value={r.employeeId}>{r.displayName}</option>)}</select></label>}
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1 }}>Luz<select style={sel} value={lighting} onChange={(e) => setLighting(e.target.value as BiometricTrial['lighting'])}>
              <option value="normal">Normal</option><option value="low">Poca luz</option><option value="backlight">Contraluz</option><option value="outdoor">Exterior</option></select></label>
            <label style={{ flex: 1 }}>Prueba de vida<select style={sel} value={challenge} onChange={(e) => setChallenge(e.target.value as 'none' | 'blink' | 'random')}>
              <option value="blink">Parpadeo</option><option value="random">Aleatoria (parpadeo o giro)</option><option value="none">Solo pasiva</option></select></label>
          </div>
          <label>Accesorios (opcional)<input style={sel} value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="lentes, gorra, mascarilla…" /></label>
          <button className="btn primary" onClick={attempt}>Iniciar intento</button>
        </>
      )}
      {running && (
        <>
          <Camera onVideo={(v) => { video.current = v; }} />
          {chText && <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--warn)', margin: 0 }}>{chText}</p>}
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{hint}</p>
          <button className="btn small" onClick={() => { stop.current = true; }}>Cancelar intento</button>
        </>
      )}
      {last && (
        <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 8 }}>
          <b>{OUTCOME[last.o.kind] ?? last.o.kind}{last.o.kind === 'identified' ? `: ${name(last.o.id.employeeId)}` : ''}</b>
          {last.t.outcomeReason && <span> ({last.t.outcomeReason})</span>}
          {last.t.condition === 'genuine' && last.o.kind === 'identified' && last.o.id.employeeId !== last.t.expectedEmployeeId && <p style={{ color: 'var(--danger)', margin: 0 }}>⚠ Identificó a otra persona</p>}
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Mejor candidato {name((last.t.metrics.top1EmployeeId as string) ?? null)} {r3(last.t.metrics.top1Score)} · segundo {r3(last.t.metrics.top2Score)} ·
            pasiva {r3(last.t.metrics.passiveScore)} · continuidad {r3(last.t.metrics.continuity)} · total {Math.round(Number(last.t.metrics.totalMs))} ms
            (detección {Math.round(Number(last.t.metrics.detectMs ?? 0))} · embedding {Math.round(Number(last.t.metrics.embedMs ?? 0))} · pasiva {Math.round(Number(last.t.metrics.padMs ?? 0))} ms/fotograma)
          </p>
        </div>
      )}
      {msg && <p style={{ fontWeight: 700, margin: 0 }}>{msg}</p>}
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Esta sesión: {done.filter((t) => t.condition !== 'benchmark').length} intentos · pendientes de enviar: {pending}</p>
      {!running && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={send} disabled={!pending}>Enviar resultados ({pending})</button>
          <button className="btn" onClick={benchmark}>Medir 1:N</button>
          <button className="btn small" onClick={onClose}>Cerrar</button>
        </div>
      )}
    </div>
  );
}
