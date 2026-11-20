import { useEffect, useRef, useState } from 'react';
import type { DevicePolicy, RosterEntry } from '@asistencia/core';
import { challengeModeFromPolicy, getEngine, runCapture, type CaptureOutcome } from '../infra/biometric/index.ts';
import { Camera } from './Camera.tsx';

export type { CaptureOutcome } from '../infra/biometric/index.ts';

/**
 * Marcación: captura con prueba de vida e identificación automáticas (sin nombre, código ni selección manual).
 * La cadena completa está en infra/biometric/capture.ts (la misma que mide el modo validación). EXPERIMENTAL.
 */
export function FaceCapture({ roster, policy, onDone }: { roster: RosterEntry[]; policy: DevicePolicy; onDone: (o: CaptureOutcome) => void }) {
  const [hint, setHint] = useState('Preparando reconocimiento…');
  const [challengeText, setChallengeText] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    let stop = false;
    const finish = (o: CaptureOutcome) => { if (!finished.current) { finished.current = true; onDone(o); } };
    (async () => {
      let eng;
      try { eng = await getEngine(); } catch (e) { return finish({ kind: 'engine_error', message: String(e) }); }
      const r = await runCapture({ eng, video: () => video.current, roster, policy, challenge: challengeModeFromPolicy(policy),
        stopped: () => stop, onHint: setHint, onChallenge: setChallengeText });
      finish(r.outcome);
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Camera onVideo={(v) => { video.current = v; }} />
      {challengeText && <p aria-live="assertive" style={{ fontSize: 30, fontWeight: 800, color: 'var(--warn)', margin: 0 }}>{challengeText}</p>}
      <p aria-live="polite" style={{ fontSize: 24, fontWeight: 700, minHeight: 34, margin: 0 }}>{hint}</p>
    </>
  );
}
