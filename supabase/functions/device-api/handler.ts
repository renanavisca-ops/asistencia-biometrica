import {
  isUuid, sha256Hex, canonicalize, stripSignature, validatePush, verifyEvent, verifyRequest, b64urlDecode,
  PROTOCOL_VERSION, type SignedAttendanceEvent, type SyncPushRequest,
} from '../_shared/core/index.ts';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { DeviceDb } from './db.ts';

const MAX_BODY = 1_000_000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-device-id, x-challenge, x-signature',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

export const activationProofBytes = (code: string, publicKey: string) =>
  new TextEncoder().encode(`asistencia.activate.v1\n${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}\n${publicKey}`);

/**
 * API de dispositivos de tienda. Los dispositivos no tienen usuario de Supabase: se autentican con su clave Ed25519
 * (generada en el teléfono durante la activación) firmando un desafío de un solo uso emitido por el servidor.
 * Rutas: POST /device-api/{activate|challenge|push|pull}
 */
export function createHandler(db: DeviceDb, log: (msg: string, extra?: unknown) => void = () => {}) {
  async function authenticate(req: Request, route: string, body: string): Promise<string | null> {
    const deviceId = req.headers.get('x-device-id') ?? '';
    const challenge = req.headers.get('x-challenge') ?? '';
    const signature = req.headers.get('x-signature') ?? '';
    if (!isUuid(deviceId) || challenge.length < 20 || signature.length < 40) return null;
    const publicKey = await db.consumeChallenge(deviceId, challenge);
    if (!publicKey) return null;
    return verifyRequest('POST', route, challenge, body, signature, publicKey) ? deviceId + '|' + publicKey : null;
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const route = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > MAX_BODY) return json(413, { error: 'payload_too_large' });
    const body = await req.text();
    if (body.length > MAX_BODY) return json(413, { error: 'payload_too_large' });

    try {
      switch (route) {
        case 'activate': {
          const b = JSON.parse(body);
          for (const k of ['code', 'publicKey', 'platform', 'proof']) if (typeof b[k] !== 'string') return json(400, { error: `missing_${k}` });
          // Prueba de posesión: el teléfono firma el código con la clave privada que acaba de generar.
          let proofOk = false;
          try { proofOk = ed25519.verify(b64urlDecode(b.proof), activationProofBytes(b.code, b.publicKey), b64urlDecode(b.publicKey)); } catch { proofOk = false; }
          if (!proofOk) return json(400, { error: 'invalid_proof' });
          const r = await db.activate({
            code: b.code, publicKey: b.publicKey, platform: b.platform,
            osVersion: String(b.osVersion ?? '').slice(0, 60), appVersion: String(b.appVersion ?? '').slice(0, 40),
            hardwareModel: String(b.hardwareModel ?? '').slice(0, 80), keyStorage: String(b.keyStorage ?? 'software').slice(0, 30),
          });
          return json(r.ok ? 200 : 400, r);
        }
        case 'challenge': {
          const b = JSON.parse(body);
          const c = isUuid(b.deviceId) ? await db.issueChallenge(b.deviceId) : null;
          // Misma respuesta para dispositivo inexistente o inactivo: no se enumeran identificadores.
          return c ? json(200, { challenge: c, serverTime: new Date().toISOString() }) : json(403, { error: 'device_not_active' });
        }
        case 'push': {
          const auth = await authenticate(req, 'push', body);
          if (!auth) return json(401, { error: 'unauthorized' });
          const [deviceId, publicKey] = auth.split('|') as [string, string];
          const parsed = JSON.parse(body) as SyncPushRequest;
          const errors = validatePush(parsed);
          if (errors.length) return json(400, { error: 'invalid_payload', details: errors.slice(0, 20) });
          const valid: unknown[] = [];
          const invalid: string[] = [];
          for (const e of parsed.events as SignedAttendanceEvent[]) {
            if (e.deviceId !== deviceId || !verifyEvent(e, publicKey)) { invalid.push(e.id); continue; }
            valid.push({ ...e, payloadHash: sha256Hex(canonicalize(stripSignature(e))) });
          }
          const acks = await db.ingest(deviceId, parsed.batchId, valid, invalid);
          await db.recordHealth(deviceId, parsed.health);
          return json(200, { batchId: parsed.batchId, serverTime: new Date().toISOString(), acks });
        }
        case 'pull': {
          const auth = await authenticate(req, 'pull', body);
          if (!auth) return json(401, { error: 'unauthorized' });
          const [deviceId] = auth.split('|') as [string, string];
          const b = JSON.parse(body);
          if (b.protocol !== PROTOCOL_VERSION) return json(400, { error: 'unsupported_protocol' });
          const known: string[] = Array.isArray(b.knownEmployeeIds) ? b.knownEmployeeIds.filter(isUuid).slice(0, 10_000) : [];
          return json(200, await db.pull(deviceId, known));
        }
        default:
          return json(404, { error: 'not_found' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof SyntaxError) return json(400, { error: 'invalid_json' });
      if (msg.includes('device_not_active')) return json(403, { error: 'device_not_active' });
      if (msg.includes('activation_throttled')) return json(429, { error: 'throttled' });
      log('device-api error', { route, msg });
      return json(500, { error: 'internal_error' });
    }
  };
}
