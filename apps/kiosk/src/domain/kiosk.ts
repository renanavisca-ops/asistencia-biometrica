import {
  assessClock, decideNextEvent, estimateServerTimeRef, generateDeviceKeyPair, signEvent, b64urlDecode, b64urlEncode,
  DEFAULT_POLICY, MAX_EVENTS_PER_BATCH, PROTOCOL_VERSION,
  type AttendanceEventPayload, type DevicePolicy, type EventType, type RosterEntry,
} from '@asistencia/core';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ApiError, type DeviceApi } from './http.ts';
import type { Platform } from './platform.ts';
import type { DeviceState, LocalEventStatus, LocalStore } from './store.ts';

/** Resultado del motor biométrico (real o simulado) para un empleado identificado. */
export interface Identification {
  employeeId: string;
  matchScore: number | null;
  matchMargin: number | null;
  padScore: number | null;
  recognitionModel: string;
  padModel: string | null;
}

export type PunchResult =
  | { kind: 'recorded'; eventType: EventType; displayName: string; at: number; flags: string[]; synced: false }
  | { kind: 'duplicate'; eventType: EventType; displayName: string; secondsSince: number }
  /** Salida antes del tiempo mínimo: la app debe preguntar y, si confirma, llamar a punch(id, { confirmEarlyOut: true }). */
  | { kind: 'confirm_early_out'; displayName: string; minutesSince: number; inAtMs: number }
  | { kind: 'refused'; reason: 'not_activated' | 'blocked' | 'unknown_employee' | 'lease_expired' | 'offline_too_long' | 'storage_error' };

export type SyncResult =
  | { ok: true; pushed: number; acks: Record<LocalEventStatus, number>; rosterSize: number; revoked: number; deviceStatus: string }
  | { ok: false; error: string; retryable: boolean };

const activationBytes = (code: string, publicKey: string) =>
  new TextEncoder().encode(`asistencia.activate.v1\n${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}\n${publicKey}`);

/** Convierte la política del servidor (umbrales null = sin calibrar) al tipo local (NaN = sin calibrar). */
export function normalizePolicy(p: Record<string, unknown> | null | undefined): DevicePolicy {
  const out: Record<string, number> = { ...DEFAULT_POLICY };
  for (const [k, v] of Object.entries(p ?? {})) {
    if (k in DEFAULT_POLICY) out[k] = v === null ? Number.NaN : Number(v);
  }
  return out as unknown as DevicePolicy;
}

export class KioskService {
  private syncing: Promise<SyncResult> | null = null;

  constructor(readonly store: LocalStore, private api: DeviceApi, private platform: Platform, private healthFlags: () => string[] = () => []) {}

  state() { return this.store.getState(); }

  /** Activación con el código de un solo uso emitido en el panel. La clave privada se genera aquí y nunca sale del teléfono. */
  async activate(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (await this.store.getState()) return { ok: false, error: 'already_activated' };
    const kp = generateDeviceKeyPair();
    const proof = b64urlEncode(ed25519.sign(activationBytes(code, kp.publicKey), b64urlDecode(kp.privateKey)));
    const info = await this.platform.deviceInfo();
    try {
      const r = await this.api.activate({
        code, publicKey: kp.publicKey, proof, platform: info.platform, osVersion: info.osVersion,
        appVersion: this.platform.appVersion, hardwareModel: info.model, keyStorage: 'sqlcipher_keystore_wrapped',
      });
      const t1 = this.platform.nowMs();
      await this.store.saveState({
        deviceId: r.deviceId, organizationId: r.organizationId, storeId: r.storeId, storeName: r.storeName, timezone: r.timezone,
        privateKey: kp.privateKey, publicKey: kp.publicKey, nextSeq: r.nextDeviceSeq, status: 'active', policy: DEFAULT_POLICY,
        serverTimeRef: estimateServerTimeRef(t1, t1, Date.parse(r.serverTime), await this.platform.monotonicMs(), await this.platform.bootId(), this.platform.tzOffsetMin()),
        rosterVersion: null, lastSyncAt: null, activatedAt: new Date(t1).toISOString(),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.code : 'network_error' };
    }
  }

  /** Registra una marcación tras identificar a la persona. Todo ocurre localmente, sin red. */
  async punch(id: Identification, opts: { confirmEarlyOut?: boolean } = {}): Promise<PunchResult> {
    const st = await this.store.getState();
    if (!st) return { kind: 'refused', reason: 'not_activated' };
    if (st.status !== 'active') return { kind: 'refused', reason: 'blocked' };
    const now = this.platform.nowMs();
    const roster = await this.store.getRoster();
    const emp = roster.find((r) => r.employeeId === id.employeeId);
    if (!emp) return { kind: 'refused', reason: 'unknown_employee' };
    if (Date.parse(emp.leaseExpiresAt) < now) return { kind: 'refused', reason: 'lease_expired' };
    const lastSync = Date.parse(st.lastSyncAt ?? st.activatedAt);
    if (st.policy.offlineMaxHours > 0 && now - lastSync > st.policy.offlineMaxHours * 3_600_000) return { kind: 'refused', reason: 'offline_too_long' };

    const [mono, bootId] = [await this.platform.monotonicMs(), await this.platform.bootId()];
    const tz = this.platform.tzOffsetMin();
    const clock = assessClock({ nowWallMs: now, nowMonotonicMs: mono, bootId, tzOffsetMin: tz, ref: st.serverTimeRef, serverTimeStaleHours: st.policy.serverTimeStaleHours });

    // Último evento conocido: el más reciente entre el confirmado por el servidor (otros teléfonos) y los locales.
    const local = await this.store.lastEventFor(id.employeeId);
    const server = emp.lastEvent;
    const serverMs = server ? Date.parse(server.occurredAt) : -Infinity;
    const last = local && local.occurredAtMs >= serverMs
      ? { id: local.id, eventType: local.eventType, occurredAtMs: local.occurredAtMs, monotonicMs: local.monotonicMs, bootId: local.bootId }
      : server ? { id: server.id, eventType: server.eventType, occurredAtMs: serverMs, monotonicMs: null, bootId: null } : null;

    const decision = decideNextEvent({ last, nowMs: clock.bestEstimateMs, nowMonotonicMs: mono, bootId, policy: st.policy, confirmEarlyOut: opts.confirmEarlyOut });
    if (decision.kind === 'confirm_early_out') {
      return { kind: 'confirm_early_out', displayName: emp.displayName, minutesSince: decision.minutesSince, inAtMs: decision.lastEvent.occurredAtMs };
    }
    if (decision.kind === 'duplicate') {
      return { kind: 'duplicate', eventType: decision.lastEvent.eventType, displayName: emp.displayName, secondsSince: decision.secondsSince };
    }

    const payload: AttendanceEventPayload = {
      id: this.platform.uuid(), deviceId: st.deviceId, storeId: st.storeId, employeeId: id.employeeId, eventType: decision.eventType,
      deviceSeq: st.nextSeq, occurredAt: new Date(clock.bestEstimateMs).toISOString(), tzOffsetMin: tz, monotonicMs: mono, bootId,
      lastServerTime: st.serverTimeRef ? new Date(st.serverTimeRef.serverTimeMs).toISOString() : null,
      estClockOffsetMs: clock.estOffsetMs == null ? null : Math.round(clock.estOffsetMs),
      clockFlags: clock.flags, decisionFlags: decision.flags.filter((f) => !clock.flags.includes(f as never)),
      capturedOffline: true, matchScore: id.matchScore, matchMargin: id.matchMargin, padScore: id.padScore,
      recognitionModel: id.recognitionModel, padModel: id.padModel, policyVersion: st.policy.version, appVersion: this.platform.appVersion,
    };
    const signed = signEvent(payload, st.privateKey);
    try {
      await this.store.appendEvent({
        id: payload.id, seq: payload.deviceSeq, employeeId: payload.employeeId, eventType: payload.eventType,
        occurredAtMs: clock.bestEstimateMs, monotonicMs: mono, bootId, status: 'pending', reason: null, payload: signed,
      }, st.nextSeq + 1);
    } catch {
      // Si el guardado falla, el estado no cambia: no hay evento ni secuencia consumida.
      return { kind: 'refused', reason: 'storage_error' };
    }
    return { kind: 'recorded', eventType: decision.eventType, displayName: emp.displayName, at: clock.bestEstimateMs, flags: [...clock.flags, ...decision.flags], synced: false };
  }

  /** Sincronización idempotente: sube la cola (reutilizando el batchId en reintentos) y descarga roster/política. */
  sync(): Promise<SyncResult> {
    if (!this.syncing) this.syncing = this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async doSync(): Promise<SyncResult> {
    let st = await this.store.getState();
    if (!st) return { ok: false, error: 'not_activated', retryable: false };
    const acc: Record<LocalEventStatus, number> = { pending: 0, accepted: 0, duplicate: 0, needs_review: 0, rejected: 0 };
    let pushed = 0;
    try {
      // 1. Subida por lotes.
      for (let i = 0; i < 50; i++) {
        let batch = await this.store.getPendingBatch();
        if (!batch) {
          const pending = await this.store.pendingEvents(MAX_EVENTS_PER_BATCH);
          if (!pending.length) break;
          batch = { batchId: this.platform.uuid(), eventIds: pending.map((e) => e.id) };
          await this.store.setPendingBatch(batch); // persistido ANTES de enviar: un reintento tras cierre usa el mismo id
        }
        const events = await this.store.eventsByIds(batch.eventIds);
        const counts = await this.store.counts();
        const info = await this.platform.deviceInfo();
        const t0 = this.platform.nowMs();
        const res = await this.api.push(st.deviceId, st.privateKey, {
          protocol: PROTOCOL_VERSION, batchId: batch.batchId, events: events.map((e) => e.payload),
          health: {
            pendingEvents: counts.pending, batteryPct: info.batteryPct, freeStorageMb: null, appVersion: this.platform.appVersion,
            osVersion: info.osVersion, recognitionModel: null, padModel: null,
            clockOffsetMs: st.serverTimeRef ? Math.round(st.serverTimeRef.serverTimeMs - st.serverTimeRef.deviceWallMs) : null, flags: this.healthFlags(),
          },
        });
        await this.store.markEvents(res.acks.map((a) => ({ eventId: a.eventId, status: a.result, reason: a.reason })));
        for (const a of res.acks) acc[a.result]++;
        pushed += res.acks.length;
        await this.store.setPendingBatch(null);
        st = await this.updateServerTime(st, t0, res.serverTime);
      }
      // 2. Descarga.
      const known = (await this.store.getRoster()).map((r) => r.employeeId);
      const t0 = this.platform.nowMs();
      const pull = await this.api.pull(st.deviceId, st.privateKey, known);
      st = await this.updateServerTime(st, t0, pull.serverTime);
      if (pull.device.status !== 'active') {
        await this.store.wipeRoster();
        await this.store.saveState({ ...st, status: pull.device.status, rosterVersion: null });
        return { ok: true, pushed, acks: acc, rosterSize: 0, revoked: known.length, deviceStatus: pull.device.status };
      }
      await this.store.replaceRoster(pull.roster as RosterEntry[]);
      await this.store.saveState({
        ...st, policy: normalizePolicy(pull.policy), rosterVersion: pull.rosterVersion, storeId: pull.device.storeId,
        storeName: pull.device.storeName, timezone: pull.device.timezone, lastSyncAt: pull.serverTime,
      });
      return { ok: true, pushed, acks: acc, rosterSize: pull.roster.length, revoked: pull.revokedEmployeeIds.length, deviceStatus: 'active' };
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 403 && e.code === 'device_not_active') {
          await this.store.wipeRoster();
          await this.store.saveState({ ...st, status: 'blocked', rosterVersion: null });
          return { ok: false, error: 'device_blocked', retryable: false };
        }
        return { ok: false, error: e.code, retryable: e.status >= 500 || e.status === 429 || e.status === 401 };
      }
      return { ok: false, error: 'network_error', retryable: true };
    }
  }

  private async updateServerTime(st: DeviceState, t0: number, serverTimeIso: string) {
    const ref = estimateServerTimeRef(t0, this.platform.nowMs(), Date.parse(serverTimeIso), await this.platform.monotonicMs(),
      await this.platform.bootId(), this.platform.tzOffsetMin());
    const next = { ...st, serverTimeRef: ref };
    await this.store.saveState(next);
    return next;
  }

  async status() {
    const st = await this.store.getState();
    return { state: st, counts: await this.store.counts(), rosterSize: (await this.store.getRoster()).length };
  }
}

/** Reintentos con backoff exponencial y jitter (5 s → 10 min). */
export function nextBackoffMs(attempt: number, rand = Math.random()) {
  const base = Math.min(600_000, 5_000 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + rand * base / 2);
}
