import type postgres from 'postgres';
import type { JobsDeps } from './handler.ts';

/** Acceso a la cola en Postgres (mismo código en producción y en las pruebas). */
export function dbDeps(sql: postgres.Sql): Pick<JobsDeps, 'secret' | 'claimStorage' | 'storageResult' | 'claimMail' | 'mailResult' | 'audit'> {
  return {
    async secret() { const [r] = await sql`select private.jobs_secret() s`; return r?.s ?? null; },
    async claimStorage(n) { return (await sql`select id::int as id, bucket, path from private.storage_cleanup_claim(${n})`) as never; },
    async storageResult(ids, ok, error) { await sql`select private.storage_cleanup_result(${ids}::bigint[], ${ok}, ${error})`; },
    async claimMail(n) { return (await sql`select * from private.mail_claim(${n})`) as never; },
    async mailResult(id, ok, error, providerId) { await sql`select private.mail_result(${id}::uuid, ${ok}, ${error}, ${providerId})`; },
    async audit(s) { await sql`select private.jobs_audit(${sql.json(s as never)})`; },
  };
}
