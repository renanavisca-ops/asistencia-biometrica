import { useEffect, useRef, useState } from 'react';
import { cosine, type DevicePolicy, type MatchResult, type RosterEntry } from '@asistencia/core';
import { ActiveChallenge, CHALLENGE_TEXT, getEngine, QUALITY_MESSAGE, randomChallenge, FreeFaceRecognitionAdapter } from '../infra/biometric/index.ts';
import type { Identification } from '../domain/kiosk.ts';
import { Camera } from './Camera.tsx';

export type CaptureOutcome =
  | { kind: 'identified'; id: Identification }
  | { kind: 'not_recognized'; bestScore: number | null }
  | { kind: 'ambiguous' }
  | { kind: 'liveness_failed'; reason: 'passive' | 'challenge_timeout' | 'identity_changed'; score?: number; threshold?: number }
  | { kind: 'uncalibrated' }
  | { kind: 'no_templates' }
  | { kind: 'timeout' }
  | { kind: 'engine_error'; message: string };

const FRONTAL_FRAMES = 3;
const MAX_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Captura con prueba de vida e identificación automáticas (sin nombre, código ni selección manual):
 * 1) rostro frontal de calidad → identidad A + prueba pasiva; 2) desafío aleatorio (parpadeo/giro);
 * 3) vuelta de frente → identidad B + prueba pasiva; 4) A y B deben ser la misma persona y la pasiva superar el umbral.
 * Todo EXPERIMENTAL (docs/PRUEBAS_ANTISPOOFING.md).
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
      let eng: FreeFaceRecognitionAdapter;
      try { eng = await getEngine(); } catch (e) { return finish({ kind: 'engine_error', message: String(e) }); }
      if (eng.gallery(roster).length === 0) return finish({ kind: 'no_templates' });
      if (![policy.matchThreshold, policy.matchMargin, policy.padThreshold].every(Number.isFinite)) return finish({ kind: 'uncalibrated' });
      const t0 = performance.now();
      const timeLeft = () => !stop && performance.now() - t0 < MAX_MS;

      /** Recoge N fotogramas frontales de calidad: embeddings + puntuación pasiva. */
      const frontal = async (n: number) => {
        const embs: Float32Array[] = []; const pads: number[] = [];
        while (timeLeft() && embs.length < n) {
          const v = video.current;
          if (!v || v.readyState < 2) { await sleep(100); continue; }
          const a = await eng.analyze(v, performance.now());
          if (!a.quality.ok || !a.aligned) { embs.length = 0; pads.length = 0; setHint(QUALITY_MESSAGE[a.quality.issues[0]!]); await sleep(60); continue; }
          setHint('No se mueva…');
          embs.push(await eng.embed(a.aligned));
          pads.push(await eng.liveness.score(v, a.faces[0]!));
          await sleep(60); // fotograma nuevo y repintado de la pantalla
        }
        return embs.length < n ? null : { emb: FreeFaceRecognitionAdapter.average(embs), pad: pads.reduce((x, y) => x + y, 0) / pads.length };
      };

      const A = await frontal(FRONTAL_FRAMES);
      if (!A) return finish({ kind: 'timeout' });

      let passive = A.pad;
      let challengeKind: string | null = null;
      let B = A;
      if (policy.activeChallenge !== 0) {
        const ch = new ActiveChallenge(randomChallenge());
        challengeKind = ch.kind;
        setChallengeText(CHALLENGE_TEXT[ch.kind]); setHint('');
        const tc = performance.now();
        let done = false;
        while (timeLeft() && performance.now() - tc < policy.challengeTimeoutSec * 1000) {
          const v = video.current;
          if (!v || v.readyState < 2) { await sleep(50); continue; }
          // Ceder el hilo en CADA vuelta: sin esto la pantalla no se repinta (no se ve la instrucción)
          // y la cámara no entrega fotogramas nuevos, así que el desafío nunca se cumple.
          await sleep(30);
          const faces = await eng.detector.detect(v, performance.now());
          if (faces.length !== 1) { setHint(faces.length ? 'Solo una persona frente a la cámara' : 'No se aleje de la cámara'); continue; }
          const left = Math.ceil(policy.challengeTimeoutSec - (performance.now() - tc) / 1000);
          setHint(`${left} s`);
          if (ch.update(faces[0]!)) { done = true; break; }
        }
        setChallengeText(null);
        if (!done) return finish({ kind: 'liveness_failed', reason: 'challenge_timeout' });
        setHint('Ahora mire de frente y quédese quieto');
        await sleep(700); // deja que la cabeza vuelva al frente: los fotogramas movidos bajan la prueba pasiva
        const b = await frontal(FRONTAL_FRAMES);
        if (!b) return finish({ kind: 'timeout' });
        B = b;
        passive = (A.pad + B.pad) / 2;
        // Continuidad: la persona tras el desafío debe ser la misma que antes.
        if (cosine(A.emb, B.emb) < policy.matchThreshold) return finish({ kind: 'liveness_failed', reason: 'identity_changed', score: cosine(A.emb, B.emb), threshold: policy.matchThreshold });
      }
      if (passive < policy.padThreshold) return finish({ kind: 'liveness_failed', reason: 'passive', score: passive, threshold: policy.padThreshold });

      const probe = FreeFaceRecognitionAdapter.average([A.emb, B.emb]);
      const m: MatchResult = eng.identify(probe, roster, policy);
      if (m.kind === 'match') {
        return finish({ kind: 'identified', id: { employeeId: m.employeeId, matchScore: m.score, matchMargin: m.margin, padScore: passive,
          recognitionModel: eng.modelVersion, padModel: `${eng.padModel}${challengeKind ? `+active:${challengeKind}` : '+passive-only'}` } });
      }
      if (m.kind === 'ambiguous') return finish({ kind: 'ambiguous' });
      if (m.kind === 'no_match') return finish({ kind: 'not_recognized', bestScore: m.bestScore });
      return finish({ kind: m.reason === 'uncalibrated' ? 'uncalibrated' : 'engine_error', message: m.reason } as CaptureOutcome);
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
