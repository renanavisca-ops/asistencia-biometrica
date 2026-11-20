import { cosine, type DevicePolicy, type MatchResult, type RosterEntry } from '@asistencia/core';
import { ActiveChallenge, CHALLENGE_TEXT, randomChallenge, type ChallengeKind } from './activeChallenge.ts';
import { FreeFaceRecognitionAdapter } from './freeEngine.ts';
import { QUALITY_MESSAGE } from './quality.ts';
import type { Identification } from '../../domain/kiosk.ts';

export type CaptureOutcome =
  | { kind: 'identified'; id: Identification }
  | { kind: 'not_recognized'; bestScore: number | null }
  | { kind: 'ambiguous' }
  | { kind: 'liveness_failed'; reason: 'passive' | 'challenge_timeout' | 'identity_changed'; score?: number; threshold?: number }
  | { kind: 'uncalibrated' }
  | { kind: 'no_templates' }
  | { kind: 'timeout'; stage?: string }
  | { kind: 'engine_error'; message: string };

/** Medidas de un intento (sin imágenes): para validación biométrica y diagnóstico de rendimiento. */
export interface CaptureMetrics {
  totalMs: number;
  frontalAMs: number | null;
  challengeMs: number | null;
  frontalBMs: number | null;
  /** Promedios por fotograma. */
  detectMs: number | null;
  embedMs: number | null;
  padMs: number | null;
  frames: number;
  /** Mejor y segundo mejor candidato (similitud coseno con la galería), aunque no se haya aceptado. */
  top1EmployeeId: string | null;
  top1Score: number | null;
  top2Score: number | null;
  passiveScore: number | null;
  continuity: number | null;
  challengeKind: ChallengeKind | null;
  challengePassed: boolean | null;
  gallerySize: number;
  templateCount: number;
}

/** Modo del desafío: política 0 = solo pasiva, 1 = parpadeo, 2 = aleatorio (parpadeo o giro). */
export const challengeModeFromPolicy = (p: DevicePolicy): 'none' | 'blink' | 'random' =>
  p.activeChallenge === 0 ? 'none' : p.activeChallenge === 2 ? 'random' : 'blink';

const FRONTAL_FRAMES = 2;
const MAX_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export interface CaptureOptions {
  eng: FreeFaceRecognitionAdapter;
  video: () => HTMLVideoElement | null;
  roster: RosterEntry[];
  policy: DevicePolicy;
  challenge: 'none' | 'blink' | 'random';
  stopped: () => boolean;
  onHint: (t: string) => void;
  onChallenge: (t: string | null) => void;
}

/**
 * Captura con prueba de vida e identificación automáticas (sin nombre, código ni selección manual):
 * 1) rostro frontal de calidad → identidad A + prueba pasiva; 2) desafío (parpadeo, o aleatorio parpadeo/giro);
 * 3) vuelta de frente → identidad B + prueba pasiva; 4) A y B deben ser la misma persona y la pasiva superar el umbral.
 * La usan la marcación (FaceCapture) y el modo validación, para medir exactamente la misma cadena. EXPERIMENTAL.
 */
export async function runCapture(o: CaptureOptions): Promise<{ outcome: CaptureOutcome; metrics: CaptureMetrics }> {
  const { eng, roster, policy } = o;
  const gallery = eng.gallery(roster);
  const m: CaptureMetrics = { totalMs: 0, frontalAMs: null, challengeMs: null, frontalBMs: null, detectMs: null, embedMs: null, padMs: null, frames: 0,
    top1EmployeeId: null, top1Score: null, top2Score: null, passiveScore: null, continuity: null, challengeKind: null, challengePassed: null,
    gallerySize: gallery.length, templateCount: gallery.reduce((a, g) => a + g.templates.length, 0) };
  const t0 = performance.now();
  const detT: number[] = [], embT: number[] = [], padT: number[] = [];
  const done = (outcome: CaptureOutcome) => {
    m.totalMs = performance.now() - t0; m.detectMs = avg(detT); m.embedMs = avg(embT); m.padMs = avg(padT);
    return { outcome, metrics: m };
  };
  if (gallery.length === 0) return done({ kind: 'no_templates' });
  if (![policy.matchThreshold, policy.matchMargin, policy.padThreshold].every(Number.isFinite)) return done({ kind: 'uncalibrated' });
  const timeLeft = () => !o.stopped() && performance.now() - t0 < MAX_MS;

  let lastIssue: string | null = null;
  /** Recoge N fotogramas frontales de calidad: embeddings + puntuación pasiva. */
  const frontal = async (n: number) => {
    const embs: Float32Array[] = []; const pads: number[] = [];
    while (timeLeft() && embs.length < n) {
      const v = o.video();
      if (!v || v.readyState < 2) { await sleep(100); continue; }
      const a = await eng.analyze(v, performance.now());
      m.frames++; detT.push(a.ms);
      if (!a.quality.ok || !a.aligned) {
        lastIssue = a.quality.issues[0] ?? lastIssue;
        // Si la cara desaparece o hay otra persona, se empieza de nuevo; un fotograma borroso suelto no descarta lo ya tomado.
        if (a.faces.length !== 1) { embs.length = 0; pads.length = 0; }
        o.onHint(QUALITY_MESSAGE[a.quality.issues[0]!]); await sleep(60); continue;
      }
      o.onHint('No se mueva…');
      let t = performance.now();
      embs.push(await eng.embed(a.aligned)); embT.push(performance.now() - t);
      t = performance.now();
      pads.push(await eng.liveness.score(v, a.faces[0]!)); padT.push(performance.now() - t);
      await sleep(60); // fotograma nuevo y repintado de la pantalla
    }
    return embs.length < n ? null : { emb: FreeFaceRecognitionAdapter.average(embs), pad: pads.reduce((x, y) => x + y, 0) / pads.length };
  };

  let ta = performance.now();
  const A = await frontal(FRONTAL_FRAMES);
  m.frontalAMs = performance.now() - ta;
  if (!A) return done({ kind: 'timeout', stage: `frente:${lastIssue ?? '-'}` });

  let passive = A.pad;
  let B = A;
  if (o.challenge !== 'none') {
    const ch = new ActiveChallenge(o.challenge === 'random' ? randomChallenge() : 'blink');
    m.challengeKind = ch.kind;
    o.onChallenge(CHALLENGE_TEXT[ch.kind]); o.onHint('');
    const tc = performance.now();
    let ok = false;
    while (timeLeft() && performance.now() - tc < policy.challengeTimeoutSec * 1000) {
      const v = o.video();
      if (!v || v.readyState < 2) { await sleep(50); continue; }
      // Ceder el hilo en CADA vuelta: sin esto la pantalla no se repinta (no se ve la instrucción)
      // y la cámara no entrega fotogramas nuevos, así que el desafío nunca se cumple.
      await sleep(30);
      const faces = await eng.detector.detect(v, performance.now());
      if (faces.length !== 1) { o.onHint(faces.length ? 'Solo una persona frente a la cámara' : 'No se aleje de la cámara'); continue; }
      o.onHint(`${Math.ceil(policy.challengeTimeoutSec - (performance.now() - tc) / 1000)} s`);
      if (ch.update(faces[0]!)) { ok = true; break; }
    }
    m.challengeMs = performance.now() - tc; m.challengePassed = ok;
    o.onChallenge(null);
    if (!ok) return done({ kind: 'liveness_failed', reason: 'challenge_timeout', score: policy.challengeTimeoutSec, threshold: policy.challengeTimeoutSec });
    o.onHint('Ahora mire de frente y quédese quieto');
    await sleep(700); // deja que la cabeza vuelva al frente: los fotogramas movidos bajan la prueba pasiva
    ta = performance.now();
    const b = await frontal(FRONTAL_FRAMES);
    m.frontalBMs = performance.now() - ta;
    if (!b) return done({ kind: 'timeout', stage: `tras_desafio:${lastIssue ?? '-'}` });
    B = b;
    passive = (A.pad + B.pad) / 2;
    // Continuidad: la persona tras el desafío debe ser la misma que antes.
    m.continuity = cosine(A.emb, B.emb);
    if (m.continuity < policy.matchThreshold) {
      m.passiveScore = passive;
      return done({ kind: 'liveness_failed', reason: 'identity_changed', score: m.continuity, threshold: policy.matchThreshold });
    }
  }
  m.passiveScore = passive;

  // Puntuaciones de todos los candidatos (para medir FAR/FRR con distintos umbrales), aunque luego se rechace.
  const probe = FreeFaceRecognitionAdapter.average([A.emb, B.emb]);
  const ranked = gallery.map((g) => ({ id: g.employeeId, s: Math.max(...g.templates.map((t) => cosine(probe, t))) })).sort((x, y) => y.s - x.s);
  m.top1EmployeeId = ranked[0]?.id ?? null; m.top1Score = ranked[0]?.s ?? null; m.top2Score = ranked[1]?.s ?? null;

  if (passive < policy.padThreshold) return done({ kind: 'liveness_failed', reason: 'passive', score: passive, threshold: policy.padThreshold });
  const r: MatchResult = eng.identify(probe, roster, policy);
  if (r.kind === 'match') {
    return done({ kind: 'identified', id: { employeeId: r.employeeId, matchScore: r.score, matchMargin: r.margin, padScore: passive,
      recognitionModel: eng.modelVersion, padModel: `${eng.padModel}${m.challengeKind ? `+active:${m.challengeKind}` : '+passive-only'}` } });
  }
  if (r.kind === 'ambiguous') return done({ kind: 'ambiguous' });
  if (r.kind === 'no_match') return done({ kind: 'not_recognized', bestScore: r.bestScore });
  return done({ kind: r.reason === 'uncalibrated' ? 'uncalibrated' : 'engine_error', message: r.reason } as CaptureOutcome);
}
