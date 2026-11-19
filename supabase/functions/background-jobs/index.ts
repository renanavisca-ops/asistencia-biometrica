// Edge Function: trabajos en segundo plano (verify_jwt = false; se autentica con x-jobs-secret guardado en Vault).
import postgres from 'postgres';
import { createJobsHandler } from './handler.ts';
import { dbDeps } from './db.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('ALERTS_FROM_EMAIL'); // p. ej. «Asistencia Tienda <alertas@su-dominio>»
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20 });

Deno.serve(createJobsHandler({
  ...dbDeps(sql),
  async removeObjects(bucket, paths) {
    // API oficial de Storage: DELETE /storage/v1/object/{bucket} con { prefixes: [...] }.
    const r = await fetch(`${URL_}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
    return r.ok ? null : `Storage ${r.status}: ${(await r.text()).slice(0, 300)}`;
  },
  sendMail: RESEND && FROM ? async (m) => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return { id: String(j.id ?? '') };
  } : null,
  panelUrl: Deno.env.get('PANEL_URL') ?? 'https://asistencia-biometrica.vercel.app',
}, (m, e) => console.error(m, JSON.stringify(e))));
