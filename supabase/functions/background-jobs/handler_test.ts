// Pruebas de background-jobs contra Postgres local con las migraciones reales (DATABASE_URL), con Storage y correo
// simulados (no se envían correos reales).
import postgres from 'postgres';
import { alertMail, createJobsHandler, type JobsDeps } from './handler.ts';
import { dbDeps } from './db.ts';

const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const URL_ = Deno.env.get('DATABASE_URL');
const sql = URL_ ? postgres(URL_, { prepare: false, max: 1, onnotice: () => {} }) : null;
const ORG = 'e0000000-0000-4000-8000-000000000000', EMP = 'e3000000-0000-4000-8000-000000000001', ADMIN = 'e0000000-0000-4000-8000-0000000000aa';
const call = (h: (r: Request) => Promise<Response>, secret?: string) =>
  h(new Request('https://f/background-jobs', { method: 'POST', headers: secret ? { 'x-jobs-secret': secret } : {} }));

async function setup() {
  await sql!.unsafe(`
    insert into vault.secrets (name, secret) values ('jobs_secret', 'secreto-de-prueba') on conflict (name) do update set secret = excluded.secret;
    insert into public.organizations (id, name) values ('${ORG}', 'Org Jobs') on conflict do nothing;
    insert into public.employees (id, organization_id, employee_code, first_name, last_name) values ('${EMP}', '${ORG}', 'J1', 'Mario', 'López') on conflict do nothing;
    insert into auth.users (id, email) values ('${ADMIN}', 'jobs@x') on conflict do nothing;
    insert into public.admins (user_id, display_name, email) values ('${ADMIN}', 'Jobs', 'jobs@x') on conflict do nothing;
    insert into public.admin_role_grants (user_id, role, organization_id) values ('${ADMIN}', 'central_admin', '${ORG}');
    insert into public.alert_rules (organization_id, email_enabled, notify_admin_ids) values ('${ORG}', true, array['${ADMIN}'::uuid]);
    insert into storage.objects (bucket_id, name, created_at) values ('hr-documents', '${ORG}/${EMP}/huerfano.pdf', now() - interval '2 days');
  `);
  await sql!`select private.enqueue_storage_orphans()`;
  await sql!`insert into public.alerts (organization_id, kind, employee_id, period_key, count, threshold) values (${ORG}, 'tardiness', ${EMP}, '2026-11', 3, 3)`;
}

function deps(over: Partial<JobsDeps> = {}) {
  const removed: string[] = [], sent: { to: string; subject: string; text: string }[] = [];
  const d: JobsDeps = {
    ...dbDeps(sql!),
    async removeObjects(_b, paths) { removed.push(...paths); await sql!`delete from storage.objects where name = any(${paths})`; return null; },
    sendMail: async (m) => { sent.push(m); return { id: 'fake-' + sent.length }; },
    panelUrl: 'https://panel.example',
    ...over,
  };
  return { d, removed, sent };
}

Deno.test({ name: 'background-jobs contra Postgres', ignore: !sql, async fn() {
  await setup();
  // Sin secreto o con secreto incorrecto: 403 y nada se procesa.
  const { d, removed, sent } = deps();
  assert((await call(createJobsHandler(d))).status === 403, 'sin secreto → 403');
  assert((await call(createJobsHandler(d), 'otro')).status === 403, 'secreto incorrecto → 403');
  assert(removed.length === 0 && sent.length === 0, 'sin efectos');

  // Correo sin configurar: el archivo se borra, el correo queda pendiente (no se reclama) y la alerta sigue en el panel.
  const nc = deps({ sendMail: null });
  const r0 = await (await call(createJobsHandler(nc.d), 'secreto-de-prueba')).json();
  assert(r0.storageDeleted === 1 && r0.mailConfigured === false, 'archivo borrado; correo no configurado: ' + JSON.stringify(r0));
  const [p0] = await sql!`select n.status, n.attempts from public.alert_notifications n where n.organization_id = ${ORG}`;
  assert(p0.status === 'pending' && p0.attempts === 0, 'correo pendiente sin gastar intentos');

  // Con correo configurado: se envía una vez, sin datos disciplinarios, y queda registrado.
  const r1 = await (await call(createJobsHandler(d), 'secreto-de-prueba')).json();
  assert(r1.mailSent === 1 && sent.length === 1 && sent[0].to === 'jobs@x', 'enviado: ' + JSON.stringify(r1));
  assert(sent[0].subject === 'Alerta de puntualidad: Mario López — 3 llegadas tarde en noviembre de 2026', 'asunto: ' + sent[0].subject);
  assert(!/disciplin|despido|sanci/i.test(sent[0].text), 'sin datos disciplinarios');
  const [p1] = await sql!`select n.status, n.provider_message_id from public.alert_notifications n where n.organization_id = ${ORG}`;
  assert(p1.status === 'sent' && p1.provider_message_id === 'fake-1', 'registro del envío');
  const r2 = await (await call(createJobsHandler(d), 'secreto-de-prueba')).json();
  assert(r2.mailSent === 0 && sent.length === 1 && r2.storageDeleted === 0, 'ejecutar de nuevo no duplica nada (idempotente)');

  // Fallo del proveedor y de Storage: se registran los errores y se reintentará.
  await sql!`insert into public.alerts (organization_id, kind, employee_id, period_key, count, threshold) values (${ORG}, 'tardiness', ${EMP}, '2026-12', 3, 3)`;
  await sql!`insert into storage.objects (bucket_id, name, created_at) values ('hr-documents', ${ORG + '/' + EMP + '/otro.pdf'}, now() - interval '2 days')`;
  await sql!`select private.enqueue_storage_orphans()`;
  const bad = deps({ sendMail: async () => { throw new Error('Resend 503'); }, removeObjects: async () => 'Storage 500: caído' });
  const r3 = await (await call(createJobsHandler(bad.d), 'secreto-de-prueba')).json();
  assert(r3.mailFailed === 1 && r3.storageFailed === 1, 'fallos contados: ' + JSON.stringify(r3));
  const [n3] = await sql!`select n.status, n.last_error from public.alert_notifications n join public.alerts a on a.id = n.alert_id where a.period_key = '2026-12'`;
  const [s3] = await sql!`select deleted_at, last_error from private.storage_deletions where path like '%otro.pdf'`;
  assert(n3.status === 'pending' && n3.last_error === 'Resend 503' && s3.deleted_at === null && s3.last_error === 'Storage 500: caído', 'errores registrados, pendientes de reintento');
  const [{ c }] = await sql!`select count(*)::int c from public.audit_log where action = 'background_jobs'`;
  assert(c >= 2, 'ejecuciones con trabajo quedan en la auditoría de plataforma');
  await sql!.end();
} });

Deno.test('contenido del correo: enlace a la alerta y texto escapado', () => {
  const m = alertMail({ id: 'n', recipient_email: 'a@x', org_name: 'Org <b>', employee_name: 'Ana & Co', store_name: 'T1', period_key: '2026-03',
    count: 4, threshold: 3, alert_id: 'AL', organization_id: 'OR' }, 'https://p');
  assert(m.html.includes('Org &lt;b&gt;') && m.html.includes('Ana &amp; Co'), 'html escapado');
  assert(m.text.includes('https://p/alerts?org=OR&id=AL') && m.subject.includes('marzo de 2026'), 'enlace y mes');
});
