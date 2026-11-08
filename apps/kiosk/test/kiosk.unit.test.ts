import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, generateDeviceKeyPair } from '@asistencia/core';
import { KioskService, nextBackoffMs, normalizePolicy } from '../src/domain/kiosk.ts';
import { DeviceApi, type Fetch } from '../src/domain/http.ts';
import { MemoryStore } from '../src/domain/store.ts';
import { FakePlatform } from './helpers.ts';

const H = 3_600_000;
const EMP = '11111111-0000-4000-8000-000000000001';

function setup(fetchImpl?: Fetch) {
  const store = new MemoryStore();
  const platform = new FakePlatform();
  const calls: string[] = [];
  const fetchFn: Fetch = fetchImpl ?? (async (url) => { calls.push(url); throw new Error('offline'); });
  const svc = new KioskService(store, new DeviceApi('https://x/device-api', fetchFn), platform);
  const kp = generateDeviceKeyPair();
  store.state = {
    deviceId: '22222222-0000-4000-8000-000000000001', organizationId: 'o', storeId: '33333333-0000-4000-8000-000000000001',
    storeName: 'S1', timezone: 'America/Guatemala', privateKey: kp.privateKey, publicKey: kp.publicKey, nextSeq: 1, status: 'active',
    policy: DEFAULT_POLICY, serverTimeRef: { serverTimeMs: platform.wall, deviceWallMs: platform.wall, monotonicMs: platform.mono, bootId: platform.boot, tzOffsetMin: -360 },
    rosterVersion: 'v1', lastSyncAt: new Date(platform.wall).toISOString(), activatedAt: new Date(platform.wall).toISOString(),
  };
  store.roster = [{ employeeId: EMP, displayName: 'María L.', leaseExpiresAt: new Date(platform.wall + 168 * H).toISOString(), lastEvent: null, templates: [] }];
  return { store, platform, svc, calls };
}
const ident = { employeeId: EMP, matchScore: null, matchMargin: null, padScore: null, recognitionModel: 'SIMULADO@0', padModel: null };

describe('KioskService (offline)', () => {
  it('salida a los 3 min pide confirmación; sin confirmar no registra; confirmada registra SALIDA', async () => {
    const { svc, store, platform } = setup();
    await svc.punch(ident);
    platform.advance(3 * 60_000);
    expect(await svc.punch(ident)).toMatchObject({ kind: 'confirm_early_out', minutesSince: 3, displayName: 'María L.' });
    expect(store.events.length).toBe(1);
    const r = await svc.punch(ident, { confirmEarlyOut: true });
    expect(r).toMatchObject({ kind: 'recorded', eventType: 'OUT' });
    expect(store.events[1]!.payload.decisionFlags).toContain('early_out_confirmed');
  });
  it('ENTRADA → duplicado dentro de la ventana → SALIDA, todo sin red', async () => {
    const { svc, store, platform } = setup();
    expect(await svc.punch(ident)).toMatchObject({ kind: 'recorded', eventType: 'IN', displayName: 'María L.' });
    platform.advance(30_000);
    expect(await svc.punch(ident)).toMatchObject({ kind: 'duplicate', eventType: 'IN', secondsSince: 30 });
    platform.advance(8 * H);
    expect(await svc.punch(ident)).toMatchObject({ kind: 'recorded', eventType: 'OUT' });
    expect(store.events.map((e) => [e.seq, e.eventType, e.status])).toEqual([[1, 'IN', 'pending'], [2, 'OUT', 'pending']]);
    expect(store.state!.nextSeq).toBe(3);
  });
  it('el cambio manual de hora no engaña: usa el reloj monotónico', async () => {
    const { svc, platform, store } = setup();
    await svc.punch(ident);
    platform.wall += 10 * H; platform.mono! += 20_000; // el usuario adelanta 10 h; solo pasaron 20 s
    expect((await svc.punch(ident)).kind).toBe('duplicate');
    platform.advance(9 * H);
    const r = await svc.punch(ident);
    expect(r).toMatchObject({ kind: 'recorded', eventType: 'OUT' });
    // La hora registrada es la estimada (servidor + monotónico), no la manipulada; y queda marcada.
    const ev = store.events[1]!;
    expect(ev.payload.clockFlags).toContain('clock_jump_forward');
    expect(ev.occurredAtMs).toBe(store.state!.serverTimeRef!.serverTimeMs + 20_000 + 9 * H);
  });
  it('fallo de escritura no altera el estado ni consume secuencia', async () => {
    const { svc, store } = setup();
    store.failNextAppend = true;
    expect(await svc.punch(ident)).toEqual({ kind: 'refused', reason: 'storage_error' });
    expect(store.events.length).toBe(0);
    expect(store.state!.nextSeq).toBe(1);
    expect(await svc.punch(ident)).toMatchObject({ kind: 'recorded', eventType: 'IN' });
  });
  it('autorización (lease) caducada → no marca', async () => {
    const { svc, platform } = setup();
    platform.advance(169 * H);
    expect(await svc.punch(ident)).toEqual({ kind: 'refused', reason: 'lease_expired' });
  });
  it('demasiado tiempo sin sincronizar según política → no marca', async () => {
    const { svc, store, platform } = setup();
    store.roster[0]!.leaseExpiresAt = new Date(platform.wall + 1000 * H).toISOString();
    platform.advance(73 * H);
    expect(await svc.punch(ident)).toEqual({ kind: 'refused', reason: 'offline_too_long' });
  });
  it('persona fuera del roster de la tienda → rechazo', async () => {
    const { svc } = setup();
    expect(await svc.punch({ ...ident, employeeId: '99999999-0000-4000-8000-000000000009' })).toEqual({ kind: 'refused', reason: 'unknown_employee' });
  });
  it('sin red: la sincronización falla de forma reintentable y conserva el batchId', async () => {
    const { svc, store } = setup();
    await svc.punch(ident);
    const r = await svc.sync();
    expect(r).toEqual({ ok: false, error: 'network_error', retryable: true });
    const b1 = store.batch; // aún no creado porque falló el desafío antes del envío
    expect(b1?.eventIds.length).toBe(1);
    await svc.sync();
    expect(store.batch?.batchId).toBe(b1!.batchId);
    expect(store.events[0]!.status).toBe('pending'); // nunca se muestra como sincronizado
  });
  it('política del servidor: null → umbral sin calibrar (NaN)', () => {
    const p = normalizePolicy({ version: 3, matchThreshold: null, antiDoubleWindowSec: 60 });
    expect(p.version).toBe(3); expect(p.antiDoubleWindowSec).toBe(60); expect(Number.isNaN(p.matchThreshold)).toBe(true);
  });
  it('backoff exponencial con tope de 10 min', () => {
    expect(nextBackoffMs(0, 1)).toBe(5000);
    expect(nextBackoffMs(20, 1)).toBe(600000);
    expect(nextBackoffMs(3, 0)).toBe(20000);
  });
});
