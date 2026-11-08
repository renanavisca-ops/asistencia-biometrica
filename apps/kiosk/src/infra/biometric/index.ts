import { FreeFaceRecognitionAdapter } from './freeEngine.ts';

export { FreeFaceRecognitionAdapter } from './freeEngine.ts';
export { CommercialFaceRecognitionAdapter, CommercialLivenessAdapter } from './commercial.ts';
export { QUALITY_MESSAGE } from './quality.ts';

/** Motor activo. Hoy solo existe el gratuito (experimental). Los comerciales son interfaces sin proveedor. */
let engine: FreeFaceRecognitionAdapter | null = null;
let ready: Promise<FreeFaceRecognitionAdapter> | null = null;
export function getEngine(): Promise<FreeFaceRecognitionAdapter> {
  ready ??= (async () => { engine = new FreeFaceRecognitionAdapter(); const t = performance.now(); await engine.init(); initMs = performance.now() - t; return engine; })();
  return ready;
}
export let initMs: number | null = null;
