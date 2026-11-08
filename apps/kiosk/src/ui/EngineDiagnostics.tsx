import { useRef, useState } from 'react';
import { cosine } from '@asistencia/core';
import { getEngine, initMs, QUALITY_MESSAGE } from '../infra/biometric/index.ts';
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
    const m = a.quality.metrics;
    const info = `detección ${Math.round(a.ms)} ms · embedding ${Math.round(performance.now() - t)} ms · ojos ${Math.round(m.interocularPx)} px · luz ${Math.round(m.brightness)} · nitidez ${Math.round(m.sharpness)}`;
    setCaps((c) => [...c.slice(-1), { emb, info }]);
    setMsg('Captura guardada en memoria (no se almacena).');
  };
  const sim = caps.length === 2 ? cosine(caps[0]!.emb, caps[1]!.emb) : null;
  return (
    <div className="overlay" style={{ alignItems: 'center' }}>
      <h1>Diagnóstico del motor</h1>
      <p className="muted" style={{ fontSize: 14 }}>Motor: sface@2021dec (EXPERIMENTAL) · carga inicial: {initMs ? `${Math.round(initMs)} ms` : '—'} · Prueba de vida: NO IMPLEMENTADA</p>
      <Camera onVideo={(v) => { video.current = v; }} />
      <button className="btn primary" onClick={capture}>Capturar {caps.length % 2 === 0 ? 'A' : 'B'}</button>
      <p>{msg}</p>
      {caps.map((c, i) => <p key={i} className="muted" style={{ fontSize: 13, margin: 0 }}>{i === 0 ? 'A' : 'B'}: {c.info}</p>)}
      {sim != null && <p style={{ fontSize: 28, fontWeight: 800 }}>Similitud A–B: {sim.toFixed(3)}</p>}
      <button className="btn small" onClick={onClose}>Cerrar</button>
    </div>
  );
}
