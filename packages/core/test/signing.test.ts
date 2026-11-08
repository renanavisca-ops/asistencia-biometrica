import { describe, expect, it } from 'vitest';
import {
  canonicalize, generateDeviceKeyPair, signEvent, verifyEvent, signRequest, verifyRequest, validatePush,
  PROTOCOL_VERSION, type AttendanceEventPayload,
} from '../src/index.ts';

const payload: AttendanceEventPayload = {
  id: '6f1c2b1e-8d3a-4c2e-9b1f-0a1b2c3d4e5f',
  deviceId: '1a2b3c4d-1111-4222-8333-444455556666',
  storeId: '2a2b3c4d-1111-4222-8333-444455556666',
  employeeId: '3a2b3c4d-1111-4222-8333-444455556666',
  eventType: 'IN', deviceSeq: 1, occurredAt: '2026-11-08T14:00:00.000Z', tzOffsetMin: -360,
  monotonicMs: 1234, bootId: 'b', lastServerTime: null, estClockOffsetMs: null, clockFlags: ['no_server_time'],
  decisionFlags: [], capturedOffline: true, matchScore: 0.7, matchMargin: 0.2, padScore: 0.9,
  recognitionModel: 'm@1', padModel: 'p@1', policyVersion: 1, appVersion: '0.1.0',
};

describe('canonicalize', () => {
  it('ordena claves y es estable', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });
  it('rechaza NaN', () => expect(() => canonicalize({ a: NaN })).toThrow());
});

describe('firma de eventos', () => {
  const kp = generateDeviceKeyPair();
  const signed = signEvent(payload, kp.privateKey);
  it('verifica con la clave pública del dispositivo', () => expect(verifyEvent(signed, kp.publicKey)).toBe(true));
  it('detecta manipulación de cualquier campo', () => {
    expect(verifyEvent({ ...signed, eventType: 'OUT' }, kp.publicKey)).toBe(false);
    expect(verifyEvent({ ...signed, occurredAt: '2026-11-08T13:00:00.000Z' }, kp.publicKey)).toBe(false);
  });
  it('rechaza la firma de otro dispositivo', () => {
    expect(verifyEvent(signed, generateDeviceKeyPair().publicKey)).toBe(false);
  });
  it('firma de petición ligada al desafío y al cuerpo', () => {
    const sig = signRequest('POST', '/device-sync/push', 'ch1', '{"a":1}', kp.privateKey);
    expect(verifyRequest('POST', '/device-sync/push', 'ch1', '{"a":1}', sig, kp.publicKey)).toBe(true);
    expect(verifyRequest('POST', '/device-sync/push', 'ch2', '{"a":1}', sig, kp.publicKey)).toBe(false);
    expect(verifyRequest('POST', '/device-sync/push', 'ch1', '{"a":2}', sig, kp.publicKey)).toBe(false);
  });
  it('validatePush acepta un lote válido y rechaza uno malformado', () => {
    const health = { pendingEvents: 1, batteryPct: null, freeStorageMb: null, appVersion: '0.1.0', osVersion: 'x',
      recognitionModel: null, padModel: null, clockOffsetMs: null, flags: [] };
    expect(validatePush({ protocol: PROTOCOL_VERSION, batchId: payload.id, events: [signed], health })).toEqual([]);
    expect(validatePush({ protocol: PROTOCOL_VERSION, batchId: 'x', events: [{ ...signed, eventType: 'X' }], health }).length).toBe(2);
  });
});
