import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { DetectedFace, FaceDetector, FrameSource, Point } from './types.ts';

// Rutas absolutas respecto del documento (en la app: https://localhost/), no del script compilado.
const BASE = new URL('./', document.baseURI).href;

/** A. Detección y puntos faciales con MediaPipe Face Landmarker (Apache-2.0), 100 % local. */
export class MediaPipeFaceDetector implements FaceDetector {
  readonly id = 'mediapipe-face-landmarker@float16-1';
  private lm: FaceLandmarker | null = null;
  private mode: 'IMAGE' | 'VIDEO' = 'VIDEO';

  async init() {
    if (this.lm) return;
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}vendor/mediapipe`);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate },
      runningMode: this.mode, numFaces: 2, outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
    });
    try { this.lm = await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { this.lm = await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  }

  async detect(src: FrameSource, timestampMs?: number): Promise<DetectedFace[]> {
    if (!this.lm) await this.init();
    const wantVideo = src instanceof HTMLVideoElement;
    const mode = wantVideo ? 'VIDEO' : 'IMAGE';
    if (mode !== this.mode) { this.mode = mode; await this.lm!.setOptions({ runningMode: mode }); }
    const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
    const h = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
    const r = wantVideo ? this.lm!.detectForVideo(src as HTMLVideoElement, timestampMs ?? performance.now()) : this.lm!.detect(src);
    return r.faceLandmarks.map((pts, i) => {
      const P = (k: number): Point => ({ x: pts[k]!.x * w, y: pts[k]!.y * h });
      // Iris (468/473) como centro de ojos; nariz 1; comisuras 61/291. Se ordenan por x de imagen (izq./der.).
      const [eA, eB] = [P(468), P(473)].sort((a, b) => a.x - b.x) as [Point, Point];
      const [mA, mB] = [P(61), P(291)].sort((a, b) => a.x - b.x) as [Point, Point];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const bs = r.faceBlendshapes?.[i]?.categories;
      const score = (n: string) => bs?.find((c) => c.categoryName === n)?.score ?? 0;
      return {
        box: { x: minX * w, y: minY * h, width: (maxX - minX) * w, height: (maxY - minY) * h },
        five: [eA, eB, P(1), mA, mB],
        blink: bs ? { left: score('eyeBlinkLeft'), right: score('eyeBlinkRight') } : null,
      };
    });
  }
}
