import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { RosterEntry } from '@asistencia/core';
import type { DeviceState, LocalEvent, LocalEventStatus, LocalStore, PendingBatch } from '../domain/store.ts';

const DB = 'asistencia_kiosk';
const SCHEMA = `
create table if not exists kv (k text primary key not null, v text not null);
create table if not exists roster (employee_id text primary key not null, data text not null);
create table if not exists events (
  id text primary key not null, seq integer not null unique, employee_id text not null, event_type text not null,
  occurred_at_ms integer not null, monotonic_ms integer, boot_id text, status text not null, reason text, payload text not null);
create index if not exists events_status on events(status, seq);
create index if not exists events_emp on events(employee_id, occurred_at_ms);
`;

function randomSecret() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Almacén en SQLite cifrado (SQLCipher). La frase secreta se genera en el primer arranque y el plugin la guarda
 * protegida por Android Keystore (EncryptedSharedPreferences) / iOS Keychain. Nunca se almacena en claro.
 */
export class SqliteStore implements LocalStore {
  private constructor(private db: SQLiteDBConnection) {}

  static async open(): Promise<SqliteStore> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const stored = (await sqlite.isSecretStored()).result;
    if (!stored) await sqlite.setEncryptionSecret(randomSecret());
    const exists = (await sqlite.isConnection(DB, false)).result;
    const db = exists ? await sqlite.retrieveConnection(DB, false) : await sqlite.createConnection(DB, true, 'secret', 1, false);
    await db.open();
    await db.execute(SCHEMA);
    return new SqliteStore(db);
  }

  private async kvGet<T>(k: string): Promise<T | null> {
    const r = await this.db.query('select v from kv where k = ?', [k]);
    return r.values?.[0] ? (JSON.parse(r.values[0].v) as T) : null;
  }
  private kvSet(k: string, v: unknown) {
    return this.db.run('insert into kv (k, v) values (?, ?) on conflict(k) do update set v = excluded.v', [k, JSON.stringify(v)]);
  }

  getState() { return this.kvGet<DeviceState>('state'); }
  async saveState(s: DeviceState) { await this.kvSet('state', s); }

  async getRoster(): Promise<RosterEntry[]> {
    const r = await this.db.query('select data from roster');
    return (r.values ?? []).map((x) => JSON.parse(x.data));
  }
  async replaceRoster(entries: RosterEntry[]) {
    await this.db.executeSet([
      { statement: 'delete from roster', values: [] },
      ...entries.map((e) => ({ statement: 'insert into roster (employee_id, data) values (?, ?)', values: [e.employeeId, JSON.stringify(e)] })),
    ], true);
  }
  async wipeRoster() { await this.db.run('delete from roster'); }
  async resetDevice() {
    await this.db.run('delete from roster');
    await this.db.run('delete from events');
    await this.db.run('delete from kv');
  }

  /** Atómico: evento + siguiente secuencia en la misma transacción. */
  async appendEvent(e: LocalEvent, nextSeq: number) {
    const st = await this.getState();
    if (!st) throw new Error('sin estado');
    await this.db.executeSet([
      { statement: `insert into events (id, seq, employee_id, event_type, occurred_at_ms, monotonic_ms, boot_id, status, reason, payload)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [e.id, e.seq, e.employeeId, e.eventType, e.occurredAtMs, e.monotonicMs, e.bootId, e.status, e.reason, JSON.stringify(e.payload)] },
      { statement: 'insert into kv (k, v) values (?, ?) on conflict(k) do update set v = excluded.v', values: ['state', JSON.stringify({ ...st, nextSeq })] },
    ], true);
  }

  private row(x: Record<string, any>): LocalEvent {
    return { id: x.id, seq: x.seq, employeeId: x.employee_id, eventType: x.event_type, occurredAtMs: x.occurred_at_ms,
      monotonicMs: x.monotonic_ms, bootId: x.boot_id, status: x.status, reason: x.reason, payload: JSON.parse(x.payload) };
  }
  async lastEventFor(employeeId: string) {
    const r = await this.db.query(`select * from events where employee_id = ? and status <> 'rejected' order by occurred_at_ms desc, seq desc limit 1`, [employeeId]);
    return r.values?.[0] ? this.row(r.values[0]) : null;
  }
  async eventsFor(employeeId: string, sinceMs: number) {
    const r = await this.db.query(`select * from events where employee_id = ? and status <> 'rejected' and occurred_at_ms >= ? order by occurred_at_ms, seq`, [employeeId, sinceMs]);
    return (r.values ?? []).map((x) => this.row(x));
  }
  async pendingEvents(limit: number) {
    const r = await this.db.query(`select * from events where status = 'pending' order by seq limit ?`, [limit]);
    return (r.values ?? []).map((x) => this.row(x));
  }
  async eventsByIds(ids: string[]) {
    if (!ids.length) return [];
    const r = await this.db.query(`select * from events where id in (${ids.map(() => '?').join(',')}) order by seq`, ids);
    return (r.values ?? []).map((x) => this.row(x));
  }
  async markEvents(acks: { eventId: string; status: LocalEventStatus; reason: string | null }[]) {
    if (!acks.length) return;
    await this.db.executeSet(acks.map((a) => ({ statement: 'update events set status = ?, reason = ? where id = ?', values: [a.status, a.reason, a.eventId] })), true);
  }
  getPendingBatch() { return this.kvGet<PendingBatch>('batch'); }
  async setPendingBatch(b: PendingBatch | null) {
    if (b) await this.kvSet('batch', b); else await this.db.run(`delete from kv where k = 'batch'`);
  }
  async counts() {
    const c: Record<LocalEventStatus, number> = { pending: 0, accepted: 0, duplicate: 0, needs_review: 0, rejected: 0 };
    const r = await this.db.query('select status, count(*) n from events group by status');
    for (const x of r.values ?? []) c[x.status as LocalEventStatus] = x.n;
    return c;
  }
}
