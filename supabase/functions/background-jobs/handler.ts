// Trabajos en segundo plano: borrado de archivos encolados (API oficial de Storage) y correos de alertas.
// Se invoca desde pg_cron/pg_net con el encabezado x-jobs-secret (secreto aleatorio en Vault). Idempotente.

export type StorageItem = { id: number; bucket: string; path: string };
export type MailItem = { id: string; recipient_email: string; org_name: string; employee_name: string; store_name: string | null;
  period_key: string; count: number; threshold: number; alert_id: string; organization_id: string };

export interface JobsDeps {
  secret(): Promise<string | null>;
  claimStorage(limit: number): Promise<StorageItem[]>;
  storageResult(ids: number[], ok: boolean, error: string | null): Promise<void>;
  /** Borra rutas de un bucket con la API de Storage. Devuelve error (texto) o null. */
  removeObjects(bucket: string, paths: string[]): Promise<string | null>;
  claimMail(limit: number): Promise<MailItem[]>;
  mailResult(id: string, ok: boolean, error: string | null, providerId: string | null): Promise<void>;
  /** null si el correo no está configurado (sin clave o remitente): entonces no se reclama nada. */
  sendMail: ((m: { to: string; subject: string; text: string; html: string }) => Promise<{ id: string }>) | null;
  audit(summary: Record<string, unknown>): Promise<void>;
  panelUrl: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (k: string) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[(m ?? 1) - 1]} de ${y}`; };

/** Contenido del correo: solo lo necesario (sin datos disciplinarios). */
export function alertMail(m: MailItem, panelUrl: string) {
  const link = `${panelUrl}/alerts?org=${m.organization_id}&id=${m.alert_id}`;
  const store = m.store_name ? ` (${m.store_name})` : '';
  const subject = `Alerta de puntualidad: ${m.employee_name} — ${m.count} llegadas tarde en ${monthName(m.period_key)}`;
  const text = `${m.org_name}\n\n${m.employee_name}${store} registró ${m.count} llegadas tarde en ${monthName(m.period_key)} (umbral: ${m.threshold}).\n` +
    `Revise el caso en el panel: ${link}\n\nRecibe este aviso porque su organización lo configuró en Alertas. Puede desactivarlo allí.`;
  const html = `<p><b>${esc(m.org_name)}</b></p><p>${esc(m.employee_name)}${esc(store)} registró <b>${m.count} llegadas tarde</b> en ${esc(monthName(m.period_key))} (umbral: ${m.threshold}).</p>` +
    `<p><a href="${esc(link)}">Revisar en el panel</a></p><p style="color:#6b7280;font-size:12px">Recibe este aviso porque su organización lo configuró en Alertas. Puede desactivarlo allí.</p>`;
  return { subject, text, html };
}

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export function createJobsHandler(d: JobsDeps, log: (m: string, e?: unknown) => void = () => {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const expected = await d.secret();
    const got = req.headers.get('x-jobs-secret') ?? '';
    if (!expected || !timingSafeEqual(got, expected)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    const summary = { storageDeleted: 0, storageFailed: 0, mailSent: 0, mailFailed: 0, mailConfigured: !!d.sendMail };

    // 1. Archivos: lotes por bucket; la API de Storage ignora rutas que ya no existen (idempotente).
    const items = await d.claimStorage(200);
    const byBucket = new Map<string, StorageItem[]>();
    for (const it of items) byBucket.set(it.bucket, [...(byBucket.get(it.bucket) ?? []), it]);
    for (const [bucket, list] of byBucket) {
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        let err: string | null;
        try { err = await d.removeObjects(bucket, chunk.map((c) => c.path)); } catch (e) { err = (e as Error).message ?? String(e); }
        await d.storageResult(chunk.map((c) => c.id), !err, err);
        if (err) { summary.storageFailed += chunk.length; log('storage remove failed', { bucket, n: chunk.length, err }); }
        else summary.storageDeleted += chunk.length;
      }
    }

    // 2. Correos: si no está configurado, nada se reclama (quedan pendientes y las alertas siguen en el panel).
    if (d.sendMail) {
      for (const m of await d.claimMail(50)) {
        try {
          const c = alertMail(m, d.panelUrl);
          const r = await d.sendMail({ to: m.recipient_email, ...c });
          await d.mailResult(m.id, true, null, r.id);
          summary.mailSent++;
        } catch (e) {
          await d.mailResult(m.id, false, (e as Error).message ?? String(e), null);
          summary.mailFailed++;
          log('mail failed', { id: m.id, err: (e as Error).message });
        }
      }
    }
    await d.audit(summary);
    return new Response(JSON.stringify(summary), { headers: { 'content-type': 'application/json' } });
  };
}
