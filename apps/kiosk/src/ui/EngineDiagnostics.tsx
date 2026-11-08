import { useRef, useState } from 'react';
import { cosine } from '@asistencia/core';
import { ActiveChallenge, CHALLENGE_TEXT, getEngine, initMs, QUALITY_MESSAGE, randomChallenge } from '../infra/biometric/index.ts';
import { poseFromFive } from '../infra/biometric/quality.ts';
import { Camera } from './Camera.tsx';

/** Diagnóstico para el encargado/pruebas: captura A y B y muestra la similitud, calidad y tiempos. No guarda nada. */
export function EngineDiagnostics({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [caps, setCaps] = useState<{ emb: Float32Array; info: string }[]>([]);
  const [msg, setMsg] = useState('Capture A y luego B (misma persona o distinta).');
  const capture = async () => {
    const eng = await getEngine();
    const v = video.current;
    if (!v) return setMsg('Cámara no lista');
    const a = await eng.analyze(v, performance.now());
    if (!a.quality.ok || !a.aligned) return setMsg(`Calidad insuficiente: ${a.quality.issues.map((i) => QUALITY_MESSAGE[i]).join(', ')}`);
    const t = performance.now();
    const emb = await eng.embed(a.aligned);
    const te = performance.now() - t, tp0 = performance.now();
    const pad = await eng.liveness.score(v, a.faces[0]!);
    const m = a.quality.metrics;
    const info = `REAL (pasiva) ${pad.toFixed(3)} · detección ${Math.round(a.ms)} ms · embedding ${Math.round(te)} ms · pasiva ${Math.round(performance.now() - tp0)} ms · ojos ${Math.round(m.interocularPx)} px · luz ${Math.round(m.brightness)} · nitidez ${Math.round(m.sharpness)}`;
    setCaps((c) => [...c.slice(-1), { emb, info }]);
    setMsg('Captura guardada en memoria (no se almacena).');
  };
  const [chMsg, setChMsg] = useState<string | null>(null);
  const challenge = async () => {
    const eng = await getEngine();
    const ch = new ActiveChallenge(randomChallenge());
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const v = video.current; if (!v) break;
      const f = await eng.detector.detect(v, performance.now());
      if (f.length === 1) {
        const b = f[0]!.blink, y = poseFromFive(f[0]!).yawRatio;
        setChMsg(`${CHALLENGE_TEXT[ch.kind]} — parpadeo ${b ? Math.max(b.left, b.right).toFixed(2) : '—'} · giro ${y.toFixed(2)}`);
        if (ch.update(f[0]!)) { setChMsg(`✅ Desafío cumplido (${CHALLENGE_TEXT[ch.kind]}) en ${((performance.now() - t0) / 1000).toFixed(1)} s`); return; }
      } else setChMsg(`${CHALLENGE_TEXT[ch.kind]} — ${f.length ? 'más de una cara' : 'sin cara'}`);
    }
    setChMsg(`❌ Desafío no cumplido en 8 s (${CHALLENGE_TEXT[ch.kind]})`);
  };
  const sim = caps.length === 2 ? cosine(caps[0]!.emb, caps[1]!.emb) : null;
  return (
    <div className="overlay" style={{ alignItems: 'center' }}>
      <h1>Diagnóstico del motor</h1>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Para pruebas de suplantación: capture su cara real, luego una foto impresa y una foto en otra pantalla, y compare «REAL (pasiva)».</p>
      <p className="muted" style={{ fontSize: 14 }}>Motor: sface@2021dec + MiniFASNet + desafío activo (EXPERIMENTALES) · carga inicial: {initMs ? `${Math.round(initMs)} ms` : '—'}</p>
      <Camera onVideo={(v) => { video.current = v; }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={capture}>Capturar {caps.length % 2 === 0 ? 'A' : 'B'}</button>
        <button className="btn" onClick={challenge}>Probar desafío</button>
      </div>
      {chMsg && <p style={{ fontWeight: 700 }}>{chMsg}</p>}
      <p>{msg}</p>
      {caps.map((c, i) => <p key={i} className="muted" style={{ fontSize: 13, margin: 0 }}>{i === 0 ? 'A' : 'B'}: {c.info}</p>)}
      {sim != null && <p style={{ fontSize: 28, fontWeight: 800 }}>Similitud A–B: {sim.toFixed(3)}</p>}
      <button className="btn small" onClick={onClose}>Cerrar</button>
    </div>
  );
}
