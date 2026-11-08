import { useEffect, useRef, useState } from 'react';
import type { DevicePolicy, MatchResult, RosterEntry } from '@asistencia/core';
import { getEngine, QUALITY_MESSAGE, FreeFaceRecognitionAdapter } from '../infra/biometric/index.ts';
import type { Identification } from '../domain/kiosk.ts';
import { Camera } from './Camera.tsx';

export type CaptureOutcome =
  | { kind: 'identified'; id: Identification }
  | { kind: 'not_recognized'; bestScore: number | null }
  | { kind: 'ambiguous' }
  | { kind: 'uncalibrated' }
  | { kind: 'no_templates' }
  | { kind: 'engine_error'; message: string };

const STABLE_FRAMES = 3; // fotogramas consecutivos con calidad suficiente
const MAX_MS = 20_000;

/**
 * Captura e identificación automáticas: sin nombre, código ni selección manual.
 * Prueba de vida: NO IMPLEMENTADA todavía (Etapa 2).
 */
export function FaceCapture({ roster, policy, onDone }: { roster: RosterEntry[]; policy: DevicePolicy; onDone: (o: CaptureOutcome) => void }) {
  const [hint, setHint] = useState('Preparando reconocimiento…');
  const video = useRef<HTMLVideoElement | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    let stop = false;
    const finish = (o: CaptureOutcome) => { if (!finished.current) { finished.current = true; onDone(o); } };
    (async () => {
      let eng: FreeFaceRecognitionAdapter;
      try { eng = await getEngine(); } catch (e) { return finish({ kind: 'engine_error', message: String(e) }); }
      if (eng.gallery(roster).length === 0) return finish({ kind: 'no_templates' });
      if (!Number.isFinite(policy.matchThreshold) || !Number.isFinite(policy.matchMargin)) return finish({ kind: 'uncalibrated' });
      const t0 = performance.now();
      const embeds: Float32Array[] = [];
      while (!stop && performance.now() - t0 < MAX_MS) {
        const v = video.current;
        if (!v || v.readyState < 2) { await new Promise((r) => setTimeout(r, 100)); continue; }
        const a = await eng.analyze(v, performance.now());
        if (!a.quality.ok || !a.aligned) { embeds.length = 0; setHint(QUALITY_MESSAGE[a.quality.issues[0]!]); await new Promise((r) => setTimeout(r, 60)); continue; }
        setHint('No se mueva…');
        embeds.push(await eng.embed(a.aligned));
        if (embeds.length < STABLE_FRAMES) continue;
        const probe = FreeFaceRecognitionAdapter.average(embeds);
        const m: MatchResult = eng.identify(probe, roster, policy);
        if (m.kind === 'match') {
          return finish({ kind: 'identified', id: { employeeId: m.employeeId, matchScore: m.score, matchMargin: m.margin, padScore: null, recognitionModel: eng.modelVersion, padModel: null } });
        }
        if (m.kind === 'ambiguous') return finish({ kind: 'ambiguous' });
        if (m.kind === 'no_match') return finish({ kind: 'not_recognized', bestScore: m.bestScore });
        return finish({ kind: m.reason === 'uncalibrated' ? 'uncalibrated' : 'engine_error', message: m.reason } as CaptureOutcome);
      }
      if (!stop) finish({ kind: 'not_recognized', bestScore: null });
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Camera onVideo={(v) => { video.current = v; }} />
      <p aria-live="polite" style={{ fontSize: 26, fontWeight: 700, minHeight: 36 }}>{hint}</p>
    </>
  );
}
