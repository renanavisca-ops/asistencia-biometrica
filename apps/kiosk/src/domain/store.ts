import type { DevicePolicy, EventType, RosterEntry, SignedAttendanceEvent } from '@asistencia/core';
import type { ServerTimeRef } from '@asistencia/core';

export type LocalEventStatus = 'pending' | 'accepted' | 'duplicate' | 'needs_review' | 'rejected';

export interface DeviceState {
  deviceId: string;
  organizationId: string;
  storeId: string;
  storeName: string;
  timezone: string;
  privateKey: string;
  publicKey: string;
  nextSeq: number;
  status: 'active' | 'blocked' | 'retired';
  policy: DevicePolicy;
  serverTimeRef: ServerTimeRef | null;
  rosterVersion: string | null;
  lastSyncAt: string | null; // última sincronización COMPLETA (push + pull) confirmada por el servidor
  /** Permiso de enrolamiento marcado en el panel (informativo; el servidor lo exige en cada enrolamiento). */
  canEnroll?: boolean;
  /** 'read_only' = membresía vencida, suspendida o en eliminación: no se marca. */
  orgAccess?: 'full' | 'read_only';
  activatedAt: string;
}

export interface LocalEvent {
  id: string;
  seq: number;
  employeeId: string;
  eventType: EventType;
  occurredAtMs: number;
  monotonicMs: number | null;
  bootId: string | null;
  status: LocalEventStatus;
  reason: string | null;
  payload: SignedAttendanceEvent;
}

export interface PendingBatch { batchId: string; eventIds: string[] }

/**
 * Almacén local. Implementaciones: MemoryStore (pruebas) y SqliteStore (SQLCipher en el teléfono).
 * appendEvent debe ser atómico: el evento y el siguiente número de secuencia se guardan juntos o nada.
 */
export interface LocalStore {
  getState(): Promise<DeviceState | null>;
  saveState(s: DeviceState): Promise<void>;
  getRoster(): Promise<RosterEntry[]>;
  replaceRoster(entries: RosterEntry[]): Promise<void>;
  appendEvent(e: LocalEvent, nextSeq: number): Promise<void>;
  lastEventFor(employeeId: string): Promise<LocalEvent | null>;
  /** Marcaciones del empleado en este teléfono desde `sinceMs` (para el resumen del turno al salir). */
  eventsFor(employeeId: string, sinceMs: number): Promise<LocalEvent[]>;
  pendingEvents(limit: number): Promise<LocalEvent[]>;
  eventsByIds(ids: string[]): Promise<LocalEvent[]>;
  markEvents(acks: { eventId: string; status: LocalEventStatus; reason: string | null }[]): Promise<void>;
  getPendingBatch(): Promise<PendingBatch | null>;
  setPendingBatch(b: PendingBatch | null): Promise<void>;
  counts(): Promise<Record<LocalEventStatus, number>>;
  /** Borra roster y plantillas (dispositivo bloqueado). Conserva la cola de eventos para auditoría. */
  wipeRoster(): Promise<void>;
}

export class MemoryStore implements LocalStore {
  state: DeviceState | null = null;
  roster: RosterEntry[] = [];
  events: LocalEvent[] = [];
  batch: PendingBatch | null = null;
  /** Permite simular un fallo a mitad de escritura en las pruebas. */
  failNextAppend = false;

  async getState() { return this.state ? structuredClone(this.state) : null; }
  async saveState(s: DeviceState) { this.state = structuredClone(s); }
  async getRoster() { return structuredClone(this.roster); }
  async replaceRoster(entries: RosterEntry[]) { this.roster = structuredClone(entries); }
  async appendEvent(e: LocalEvent, nextSeq: number) {
    if (this.failNextAppend) { this.failNextAppend = false; throw new Error('fallo simulado de escritura'); }
    if (!this.state) throw new Error('sin estado');
    this.events.push(structuredClone(e));
    this.state.nextSeq = nextSeq;
  }
  async lastEventFor(employeeId: string) {
    const list = this.events.filter((e) => e.employeeId === employeeId && e.status !== 'rejected')
      .sort((a, b) => b.occurredAtMs - a.occurredAtMs || b.seq - a.seq);
    return list[0] ? structuredClone(list[0]) : null;
  }
  async eventsFor(employeeId: string, sinceMs: number) {
    return structuredClone(this.events.filter((e) => e.employeeId === employeeId && e.status !== 'rejected' && e.occurredAtMs >= sinceMs)
      .sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.seq - b.seq));
  }
  async pendingEvents(limit: number) {
    return structuredClone(this.events.filter((e) => e.status === 'pending').sort((a, b) => a.seq - b.seq).slice(0, limit));
  }
  async eventsByIds(ids: string[]) { return structuredClone(this.events.filter((e) => ids.includes(e.id)).sort((a, b) => a.seq - b.seq)); }
  async markEvents(acks: { eventId: string; status: LocalEventStatus; reason: string | null }[]) {
    for (const a of acks) {
      const e = this.events.find((x) => x.id === a.eventId);
      if (e) { e.status = a.status; e.reason = a.reason; }
    }
  }
  async getPendingBatch() { return this.batch ? structuredClone(this.batch) : null; }
  async setPendingBatch(b: PendingBatch | null) { this.batch = b ? structuredClone(b) : null; }
  async counts() {
    const c: Record<LocalEventStatus, number> = { pending: 0, accepted: 0, duplicate: 0, needs_review: 0, rejected: 0 };
    for (const e of this.events) c[e.status]++;
    return c;
  }
  async wipeRoster() { this.roster = []; }
}
