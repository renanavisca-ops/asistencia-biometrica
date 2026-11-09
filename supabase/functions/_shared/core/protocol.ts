import type { DevicePolicy, SignedAttendanceEvent } from './types.ts';

/** Protocolo de sincronización dispositivo ↔ servidor (Edge Function `device-sync`). Versión 1. */
export const PROTOCOL_VERSION = 1;
export const MAX_EVENTS_PER_BATCH = 200;

export interface DeviceHealthReport {
  pendingEvents: number;
  batteryPct: number | null;
  freeStorageMb: number | null;
  appVersion: string;
  osVersion: string;
  recognitionModel: string | null;
  padModel: string | null;
  clockOffsetMs: number | null;
  flags: string[];
}

export interface SyncPushRequest {
  protocol: number;
  batchId: string; // UUID generado por el dispositivo; reintentos usan el mismo id
  events: SignedAttendanceEvent[];
  health: DeviceHealthReport;
}

export type AckResult = 'accepted' | 'duplicate' | 'needs_review' | 'rejected';

export interface SyncAck {
  eventId: string;
  result: AckResult;
  reason: string | null;
}

export interface SyncPushResponse {
  batchId: string;
  serverTime: string;
  acks: SyncAck[];
}

export interface RosterEntry {
  employeeId: string;
  displayName: string; // solo nombre para la confirmación en pantalla
  /** Para el saludo (Bienvenido/Bienvenida). null = no indicado (saludo neutro). */
  gender?: 'F' | 'M' | null;
  leaseExpiresAt: string;
  lastEvent: { id: string; eventType: 'IN' | 'OUT'; occurredAt: string; outKind?: 'break' | 'end' | null } | null;
  templates: { templateId: string; modelVersion: string; dims: number; vectorB64: string }[];
}

export interface SyncPullResponse {
  serverTime: string;
  policy: DevicePolicy;
  rosterVersion: string;
  roster: RosterEntry[];
  /** Empleados cuyos datos locales deben eliminarse en esta sincronización. */
  revokedEmployeeIds: string[];
  device: { status: 'active' | 'blocked' | 'retired'; storeId: string; storeName: string; timezone: string };
}

export type ValidationError = { field: string; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

/** Validación estricta del lado servidor; no confía en ningún campo del cliente. */
export function validateEvent(e: unknown, idx: number): ValidationError[] {
  const errs: ValidationError[] = [];
  const f = (field: string, message: string) => errs.push({ field: `events[${idx}].${field}`, message });
  if (typeof e !== 'object' || e === null) return [{ field: `events[${idx}]`, message: 'no es objeto' }];
  const o = e as Record<string, unknown>;
  for (const k of ['id', 'deviceId', 'storeId', 'employeeId']) if (!isUuid(o[k])) f(k, 'uuid inválido');
  if (o.eventType !== 'IN' && o.eventType !== 'OUT') f('eventType', 'debe ser IN u OUT');
  if (!Number.isSafeInteger(o.deviceSeq) || (o.deviceSeq as number) < 1) f('deviceSeq', 'entero positivo');
  if (typeof o.occurredAt !== 'string' || Number.isNaN(Date.parse(o.occurredAt))) f('occurredAt', 'fecha ISO');
  if (!Number.isInteger(o.tzOffsetMin) || Math.abs(o.tzOffsetMin as number) > 14 * 60) f('tzOffsetMin', 'fuera de rango');
  if (o.monotonicMs !== null && !Number.isSafeInteger(o.monotonicMs)) f('monotonicMs', 'entero o null');
  if (!Array.isArray(o.clockFlags) || !o.clockFlags.every((x) => typeof x === 'string')) f('clockFlags', 'array');
  if (!Array.isArray(o.decisionFlags) || !o.decisionFlags.every((x) => typeof x === 'string')) f('decisionFlags', 'array');
  if (typeof o.capturedOffline !== 'boolean') f('capturedOffline', 'boolean');
  for (const k of ['matchScore', 'matchMargin', 'padScore', 'estClockOffsetMs'])
    if (o[k] !== null && typeof o[k] !== 'number') f(k, 'número o null');
  if (!Number.isInteger(o.policyVersion)) f('policyVersion', 'entero');
  if (typeof o.signature !== 'string' || o.signature.length < 80) f('signature', 'firma ausente');
  if (typeof o.appVersion !== 'string' || o.appVersion.length > 40) f('appVersion', 'texto');
  return errs;
}

export function validatePush(body: unknown): ValidationError[] {
  if (typeof body !== 'object' || body === null) return [{ field: 'body', message: 'no es objeto' }];
  const b = body as Record<string, unknown>;
  const errs: ValidationError[] = [];
  if (b.protocol !== PROTOCOL_VERSION) errs.push({ field: 'protocol', message: 'versión no soportada' });
  if (!isUuid(b.batchId)) errs.push({ field: 'batchId', message: 'uuid inválido' });
  if (!Array.isArray(b.events)) errs.push({ field: 'events', message: 'array requerido' });
  else {
    if (b.events.length > MAX_EVENTS_PER_BATCH) errs.push({ field: 'events', message: 'lote demasiado grande' });
    b.events.forEach((e, i) => errs.push(...validateEvent(e, i)));
  }
  if (typeof b.health !== 'object' || b.health === null) errs.push({ field: 'health', message: 'requerido' });
  return errs;
}
