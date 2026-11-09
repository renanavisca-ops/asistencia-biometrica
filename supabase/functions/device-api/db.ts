import postgres from 'postgres';

/** Acceso a datos del API de dispositivos. Solo llama funciones del esquema private (security definer). */
export interface DeviceDb {
  activate(p: {
    code: string; publicKey: string; platform: string; osVersion: string; appVersion: string; hardwareModel: string; keyStorage: string;
  }): Promise<Record<string, unknown>>;
  issueChallenge(deviceId: string): Promise<string | null>;
  consumeChallenge(deviceId: string, challenge: string): Promise<string | null>;
  ingest(deviceId: string, batchId: string, events: unknown[], invalidIds: string[]): Promise<unknown[]>;
  recordHealth(deviceId: string, health: unknown): Promise<void>;
  pull(deviceId: string, knownEmployeeIds: string[]): Promise<Record<string, unknown>>;
  /** Autorización de un solo uso para el modo enrolamiento (null si el teléfono no tiene permiso). */
  enrollTicket(deviceId: string): Promise<string | null>;
  close(): Promise<void>;
}

export function createDb(url: string): DeviceDb {
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  const j = (v: unknown) => sql.json(v as postgres.JSONValue);
  return {
    async activate(p) {
      const [r] = await sql`select private.activate_device(${p.code}, ${p.publicKey}, ${p.platform}, ${p.osVersion},
        ${p.appVersion}, ${p.hardwareModel}, ${p.keyStorage}) as r`;
      return r!.r;
    },
    async issueChallenge(id) {
      const [r] = await sql`select private.issue_challenge(${id}::uuid) as c`;
      return r!.c ?? null;
    },
    async consumeChallenge(id, ch) {
      const [r] = await sql`select private.consume_challenge(${id}::uuid, ${ch}) as k`;
      return r!.k ?? null;
    },
    async ingest(id, batchId, events, invalid) {
      const [r] = await sql`select private.ingest_device_events(${id}::uuid, ${batchId}::uuid, ${j(events)}::jsonb,
        ${sql.array(invalid)}::uuid[]) as r`;
      return r!.r;
    },
    async recordHealth(id, health) {
      await sql`select private.record_device_health(${id}::uuid, ${j(health)}::jsonb)`;
    },
    async pull(id, known) {
      const [r] = await sql`select private.device_pull(${id}::uuid, ${sql.array(known)}::uuid[]) as r`;
      return r!.r;
    },
    async enrollTicket(id) {
      const [r] = await sql`select private.issue_enroll_ticket(${id}::uuid) as t`;
      return r!.t ?? null;
    },
    async close() {
      await sql.end();
    },
  };
}
