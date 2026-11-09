import { signRequest, PROTOCOL_VERSION, type SyncPullResponse, type SyncPushRequest, type SyncAck } from '@asistencia/core';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<any> }>;

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(`${status} ${code}`); }
}

/** Cliente del API de dispositivos (Edge Function device-api). */
export class DeviceApi {
  constructor(private baseUrl: string, private fetchFn: Fetch) {}

  private async post(route: string, body: string, headers: Record<string, string> = {}) {
    const res = await this.fetchFn(`${this.baseUrl}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    const json = await res.json().catch(() => ({}));
    if (res.status !== 200) throw new ApiError(res.status, json?.error ?? 'http_error');
    return json;
  }

  activate(body: Record<string, string>) { return this.post('activate', JSON.stringify(body)); }

  private async signed(route: 'push' | 'pull' | 'enroll-ticket', deviceId: string, privateKey: string, payload: unknown) {
    const { challenge } = await this.post('challenge', JSON.stringify({ deviceId }));
    const body = JSON.stringify(payload);
    const signature = signRequest('POST', route, challenge, body, privateKey);
    return this.post(route, body, { 'x-device-id': deviceId, 'x-challenge': challenge, 'x-signature': signature });
  }

  push(deviceId: string, privateKey: string, req: SyncPushRequest): Promise<{ batchId: string; serverTime: string; acks: SyncAck[] }> {
    return this.signed('push', deviceId, privateKey, req);
  }

  /** Autorización de un solo uso para el modo enrolamiento (403 enroll_not_allowed si el teléfono no tiene permiso). */
  enrollTicket(deviceId: string, privateKey: string): Promise<{ ticket: string; expiresInSec: number }> {
    return this.signed('enroll-ticket', deviceId, privateKey, {});
  }

  pull(deviceId: string, privateKey: string, knownEmployeeIds: string[]): Promise<SyncPullResponse & { policy: Record<string, number | null> | null }> {
    return this.signed('pull', deviceId, privateKey, { protocol: PROTOCOL_VERSION, knownEmployeeIds });
  }
}
