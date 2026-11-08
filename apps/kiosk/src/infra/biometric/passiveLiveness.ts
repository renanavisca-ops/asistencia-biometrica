import * as ort from 'onnxruntime-web/wasm';
import type { DetectedFace, FrameSource, LivenessDetector } from './types.ts';
import { cropBox } from './crop.ts';
export { cropBox } from './crop.ts';

const BASE = new URL('./', document.baseURI).href;
const MODELS = [
  { file: 'minifasnet_v2_2.7.onnx', scale: 2.7 },
  { file: 'minifasnet_v1se_4.0.onnx', scale: 4.0 },
] as const;

/**
 * C. Prueba de vida PASIVA (MiniFASNet V2 + V1SE, Silent-Face, Apache-2.0). EXPERIMENTAL, no certificada.
 * Devuelve la probabilidad media de "real" (0–1). Se combina SIEMPRE con el desafío activo.
 */
export class MiniFasPassiveLiveness implements LivenessDetector {
  readonly id = 'minifasnet-v2+v1se@silentface';
  readonly experimental = true;
  private sessions: ort.InferenceSession[] = [];
  private canvas: HTMLCanvasElement | null = null;

  async init() {
    if (this.sessions.length) return;
    ort.env.wasm.wasmPaths = `${BASE}vendor/ort/`;
    ort.env.wasm.numThreads = 1;
    this.sessions = await Promise.all(MODELS.map((m) => ort.InferenceSession.create(`${BASE}models/${m.file}`, { executionProviders: ['wasm'] })));
  }

  async score(src: FrameSource, face: DetectedFace): Promise<number> {
    if (!this.sessions.length) await this.init();
    const w = src instanceof HTMLVideoElement ? src.videoWidth : src.width, h = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
    this.canvas ??= document.createElement('canvas');
    this.canvas.width = 80; this.canvas.height = 80;
    const g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    let total = 0;
    for (let i = 0; i < MODELS.length; i++) {
      const c = cropBox(w, h, face.box, MODELS[i]!.scale);
      g.imageSmoothingEnabled = true;
      g.drawImage(src, c.l, c.t, c.w, c.h, 0, 0, 80, 80);
      const px = g.getImageData(0, 0, 80, 80).data, n = 80 * 80, data = new Float32Array(3 * n);
      for (let k = 0; k < n; k++) { data[k] = px[k * 4 + 2]!; data[n + k] = px[k * 4 + 1]!; data[2 * n + k] = px[k * 4]!; } // BGR, 0–255
      const s = this.sessions[i]!;
      const o = (await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', data, [1, 3, 80, 80]) }))[s.outputNames[0]!]!.data as Float32Array;
      const mx = Math.max(o[0]!, o[1]!, o[2]!), e = [o[0]!, o[1]!, o[2]!].map((v) => Math.exp(v - mx)), sum = e[0]! + e[1]! + e[2]!;
      total += e[1]! / sum;
    }
    return total / MODELS.length;
  }
}
