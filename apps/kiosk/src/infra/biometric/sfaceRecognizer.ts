import * as ort from 'onnxruntime-web/wasm';
import { l2normalize } from '@asistencia/core';
import type { FaceRecognizer } from './types.ts';

// Rutas absolutas respecto del documento (en la app: https://localhost/), no del script compilado.
const BASE = new URL('./', document.baseURI).href;

/**
 * B. SFace (OpenCV Zoo, MobileFaceNet) vía ONNX Runtime WebAssembly, 100 % local.
 * EXPERIMENTAL: pesos Apache-2.0; procedencia de los datos de entrenamiento no verificada (docs/MOTORES_BIOMETRICOS_GRATUITOS.md).
 * Entrada: cara alineada 112×112, RGB, valores 0–255, NCHW (equivalente a cv::FaceRecognizerSF). Salida: 128-d.
 */
export class SFaceRecognizer implements FaceRecognizer {
  readonly modelVersion = 'sface@2021dec';
  readonly dims = 128;
  private session: ort.InferenceSession | null = null;

  async init() {
    if (this.session) return;
    ort.env.wasm.wasmPaths = `${BASE}vendor/ort/`;
    ort.env.wasm.numThreads = 1; // la WebView no está aislada (sin SharedArrayBuffer)
    this.session = await ort.InferenceSession.create(`${BASE}models/sface_2021dec.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }

  async embed(aligned: HTMLCanvasElement): Promise<Float32Array> {
    if (!this.session) await this.init();
    const px = aligned.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, 112, 112).data;
    const n = 112 * 112, data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { data[i] = px[i * 4]!; data[n + i] = px[i * 4 + 1]!; data[2 * n + i] = px[i * 4 + 2]!; }
    const s = this.session!;
    const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', data, [1, 3, 112, 112]) });
    return l2normalize(out[s.outputNames[0]!]!.data as Float32Array);
  }
}
