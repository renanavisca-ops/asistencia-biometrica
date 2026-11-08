import { l2normalize, matchOneToN, b64urlDecode, type DevicePolicy, type GalleryEntry, type MatchResult, type RosterEntry } from '@asistencia/core';
import { alignFace } from './align.ts';
import { assessQuality, DEFAULT_QUALITY, imageStats, type QualityPolicy } from './quality.ts';
import { MediaPipeFaceDetector } from './mediapipeDetector.ts';
import { SFaceRecognizer } from './sfaceRecognizer.ts';
import { MiniFasPassiveLiveness } from './passiveLiveness.ts';
import type { FaceDetector, FaceRecognizer, FrameAnalysis, FrameSource } from './types.ts';

/**
 * Motor gratuito: MediaPipe (detección) + SFace (reconocimiento). EXPERIMENTAL.
 * La prueba de vida (FreeLivenessAdapter) se integra en la Etapa 2.
 */
export class FreeFaceRecognitionAdapter {
  readonly kind = 'free' as const;
  readonly experimental = true;
  readonly label: string;
  private alignCanvas: HTMLCanvasElement | null = null;

  constructor(readonly detector: FaceDetector = new MediaPipeFaceDetector(), readonly recognizer: FaceRecognizer = new SFaceRecognizer(),
    readonly liveness: MiniFasPassiveLiveness = new MiniFasPassiveLiveness(), readonly quality: QualityPolicy = DEFAULT_QUALITY) {
    this.label = `${recognizer.modelVersion} (experimental)`;
  }
  get modelVersion() { return this.recognizer.modelVersion; }

  async init() { await Promise.all([this.detector.init(), this.recognizer.init(), this.liveness.init()]); }
  get padModel() { return this.liveness.id; }

  /** Detecta, alinea y evalúa calidad de un fotograma (sin generar embedding). */
  async analyze(src: FrameSource, ts?: number): Promise<FrameAnalysis> {
    const t0 = performance.now();
    const faces = await this.detector.detect(src, ts);
    let aligned: HTMLCanvasElement | null = null, stats = null;
    if (faces.length === 1) {
      this.alignCanvas ??= document.createElement('canvas');
      aligned = alignFace(src, faces[0]!.five, this.alignCanvas);
      stats = imageStats(aligned.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, 112, 112).data, 112, 112);
    }
    return { faces, quality: assessQuality(faces, stats, this.quality), aligned, ms: performance.now() - t0 };
  }

  embed(aligned: HTMLCanvasElement) { return this.recognizer.embed(aligned); }

  /** Promedio normalizado de varios embeddings de la misma captura (más estable que uno solo). */
  static average(list: Float32Array[]): Float32Array {
    const acc = new Float32Array(list[0]!.length);
    for (const v of list) for (let i = 0; i < acc.length; i++) acc[i]! += v[i]!;
    return l2normalize(acc);
  }

  /** Galería de la tienda: solo plantillas generadas con ESTE modelo (los embeddings de modelos distintos no son comparables). */
  gallery(roster: RosterEntry[]): GalleryEntry[] {
    return roster.map((r) => ({
      employeeId: r.employeeId, modelVersion: this.modelVersion,
      templates: r.templates.filter((t) => t.modelVersion === this.modelVersion && t.dims === this.recognizer.dims)
        .map((t) => new Float32Array(b64urlDecode(t.vectorB64).buffer.slice(0) as ArrayBuffer)),
    })).filter((g) => g.templates.length > 0);
  }

  identify(probe: Float32Array, roster: RosterEntry[], policy: DevicePolicy): MatchResult {
    return matchOneToN({ probe, probeModelVersion: this.modelVersion, gallery: this.gallery(roster), threshold: policy.matchThreshold, minMargin: policy.matchMargin });
  }
}
