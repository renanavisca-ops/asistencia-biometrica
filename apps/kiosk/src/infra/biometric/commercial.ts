import { EngineNotIntegratedError, type FaceRecognizer, type LivenessDetector } from './types.ts';

/**
 * Interfaces preparadas para motores comerciales futuros. NO hay proveedor contratado ni integración:
 * cualquier uso lanza EngineNotIntegratedError (nunca devuelve resultados simulados).
 */
export class CommercialFaceRecognitionAdapter implements FaceRecognizer {
  readonly modelVersion = 'commercial@none';
  readonly dims = 0;
  async init(): Promise<void> { throw new EngineNotIntegratedError('CommercialFaceRecognitionAdapter'); }
  async embed(): Promise<Float32Array> { throw new EngineNotIntegratedError('CommercialFaceRecognitionAdapter'); }
}

export class CommercialLivenessAdapter implements LivenessDetector {
  readonly id = 'commercial-liveness@none';
  readonly experimental = false;
  async init(): Promise<void> { throw new EngineNotIntegratedError('CommercialLivenessAdapter'); }
}
