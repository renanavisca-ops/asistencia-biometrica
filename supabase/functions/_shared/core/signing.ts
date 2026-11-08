import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalize } from './canonical.ts';
import type { AttendanceEventPayload, SignedAttendanceEvent } from './types.ts';

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Claves Ed25519 del dispositivo. En producción la privada se guarda en Keystore/Keychain (ver docs/SECURITY_PRIVACY.md). */
export function generateDeviceKeyPair(): { privateKey: string; publicKey: string } {
  const { secretKey, publicKey } = ed25519.keygen();
  return { privateKey: b64urlEncode(secretKey), publicKey: b64urlEncode(publicKey) };
}

export function eventSigningBytes(payload: AttendanceEventPayload): Uint8Array {
  return enc.encode('asistencia.event.v1\n' + canonicalize(payload));
}

export function signEvent(payload: AttendanceEventPayload, privateKeyB64: string): SignedAttendanceEvent {
  const sig = ed25519.sign(eventSigningBytes(payload), b64urlDecode(privateKeyB64));
  return { ...payload, signature: b64urlEncode(sig) };
}

export function stripSignature(e: SignedAttendanceEvent): AttendanceEventPayload {
  const { signature: _s, ...payload } = e;
  return payload;
}

export function verifyEvent(e: SignedAttendanceEvent, publicKeyB64: string): boolean {
  try {
    return ed25519.verify(b64urlDecode(e.signature), eventSigningBytes(stripSignature(e)), b64urlDecode(publicKeyB64));
  } catch {
    return false;
  }
}

/**
 * Firma de una petición de sincronización. El servidor emite un desafío (challenge) firmado y de vida corta,
 * por lo que la autenticación no depende de que el reloj del teléfono sea correcto.
 */
export function requestSigningBytes(method: string, path: string, challenge: string, body: string): Uint8Array {
  return enc.encode(['asistencia.req.v1', method.toUpperCase(), path, challenge, sha256Hex(body)].join('\n'));
}

export function signRequest(method: string, path: string, challenge: string, body: string, privateKeyB64: string): string {
  return b64urlEncode(ed25519.sign(requestSigningBytes(method, path, challenge, body), b64urlDecode(privateKeyB64)));
}

export function verifyRequest(
  method: string,
  path: string,
  challenge: string,
  body: string,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    return ed25519.verify(
      b64urlDecode(signatureB64),
      requestSigningBytes(method, path, challenge, body),
      b64urlDecode(publicKeyB64),
    );
  } catch {
    return false;
  }
}
