// Recorrido de navegador del panel (Chromium real) contra el entorno local de scripts/test-panel-e2e.sh.
// Cada paso se registra como aprobado o fallido; el proceso termina con código 1 si alguno falla.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import postgres from 'postgres';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.PANEL_URL ?? 'http://localhost:3100';
const SHOTS = process.env.SHOTS ?? '/tmp/panel-e2e-shots';
const PASSWORD = 'Prueba-E2E-1234';
const ME = 'e2e10000-0000-4000-8000-000000000001', C1 = 'e2e10000-0000-4000-8000-000000000002';
const T1 = 'e2e30000-0000-4000-8000-000000000002';
const ANA = 'e2e40000-0000-4000-8000-000000000001', BRUNO = 'e2e40000-0000-4000-8000-000000000002', CARLA = 'e2e40000-0000-4000-8000-000000000003';
const REASON = 'Faltante de mercadería comprobado en inventario';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const browser = await chromium.launch();
async function as(email, fn) {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'es-GT', timezoneId: 'America/Guatemala' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  try { await page.waitForURL((u) => !u.pathname.startsWith('/login') && !u.pathname.startsWith('/mfa'), { timeout: 20000 }); }
  catch (e) { await page.screenshot({ path: `${SHOTS}/FALLO-login-${email}.png` }); results.push({ ok: false, name: `[${email}] inicio de sesión`, err: (await page.locator('.msg').allTextContents()).join(' ') || String(e.message).split('\n')[0] }); await ctx.close(); return; }
  try { await fn(page); } finally {
    if (errors.length) results.push({ ok: false, name: `[${email}] errores de JavaScript en el navegador`, err: errors.join(' | ') });
    await ctx.close();
  }
}
async function step(name, fn, page) {
  try { await fn(); results.push({ ok: true, name }); }
  catch (e) {
    results.push({ ok: false, name, err: String(e?.message ?? e).split('\n')[0] });
    if (page) await page.screenshot({ path: `${SHOTS}/FALLO-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
/** Espera a que el texto aparezca en la página (textContent: sin mayúsculas de CSS ni elementos de listas cerradas). */
const expectText = async (page, text, timeout = 8000) => {
  try { await page.waitForFunction((t) => document.body.textContent.includes(t), text, { timeout }); }
  catch { throw new Error(`no aparece «${text}» en ${page.url()}`); }
};
const expectNoText = async (page, text) => { if (await page.evaluate((t) => document.body.textContent.includes(t), text)) throw new Error(`no debía mostrarse: «${text}» en ${page.url()}`); };
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const go = async (page, path) => { await page.goto(BASE + path); await page.waitForLoadState('networkidle'); };

// ===================== Propietario =====================
await as('owner@e2e.test', async (page) => {
  await step('Propietario: entra a su organización propia con la franja de contexto', async () => {
    await expectText(page, 'Área: organización'); await expectText(page, 'Mi Empresa');
    await shot(page, '01-propietario-organizacion');
  }, page);
  await step('Propietario: el selector ofrece «Mi plataforma» y su empresa, no organizaciones ajenas', async () => {
    const opts = await page.locator('select[aria-label="Cambiar de área"] option').allTextContents();
    if (!opts.some((o) => o.includes('Mi plataforma')) || !opts.some((o) => o.includes('Mi Empresa'))) throw new Error('opciones: ' + opts.join(', '));
    if (opts.some((o) => o.includes('Cliente Uno'))) throw new Error('aparece Cliente Uno sin acceso de soporte');
  }, page);
  await step('Propietario: cambia a Mi plataforma (menú y franja propios)', async () => {
    await page.locator('select[aria-label="Cambiar de área"]').selectOption('__platform');
    await page.waitForURL(/\/platform$/);
    await expectText(page, 'Administración global de la plataforma'); await expectText(page, 'Resumen de la plataforma');
    await expectText(page, 'Planes'); await expectNoText(page, 'Disciplina');
    await shot(page, '02-plataforma-resumen');
  }, page);
  await step('Propietario: no ve datos laborales de un cliente aunque fuerce la URL', async () => {
    await go(page, `/employees/${ANA}?org=${C1}`);
    await expectNoText(page, 'Tardía'); await expectNoText(page, REASON);
    await go(page, `/employees?org=${C1}`);
    await expectNoText(page, 'Tardía');
  }, page);
  await step('Propietario: crea una organización con límites', async () => {
    await go(page, '/platform/organizations');
    await page.getByText('Crear organización cliente').click();
    const f = page.locator('form').filter({ has: page.locator('input[name=admin_email]') });
    await f.locator('input[name=name]').fill('Cliente Nuevo E2E');
    await f.locator('input[name=legal_name]').fill('Cliente Nuevo S.A.');
    await f.locator('input[name=max_employees]').fill('2');
    await f.locator('input[name=max_stores]').fill('1');
    await f.getByRole('button', { name: 'Crear organización' }).click();
    await expectText(page, 'Organización creada');
    const [o] = await sql`select id, paid_max_employees, max_stores from public.organizations where name = 'Cliente Nuevo E2E'`;
    if (!o || o.paid_max_employees !== 2 || o.max_stores !== 1) throw new Error('organización/límites: ' + JSON.stringify(o));
    await go(page, '/platform/organizations');
    await expectText(page, 'Cliente Nuevo E2E');
    await shot(page, '03-plataforma-organizaciones');
  }, page);
  await step('Propietario: aplica un plan comercial', async () => {
    const row = page.locator('tr', { hasText: 'Cliente Nuevo E2E' });
    await row.locator('select[name=plan_id]').selectOption({ label: 'Hasta 10' });
    await row.getByRole('button', { name: 'Aplicar' }).click();
    await expectText(page, 'Plan aplicado');
    const [o] = await sql`select paid_max_employees from public.organizations where name = 'Cliente Nuevo E2E'`;
    if (o.paid_max_employees !== 10) throw new Error('límite tras el plan: ' + o.paid_max_employees);
  }, page);
  await step('Propietario: limita Cliente Uno a 3 empleados vigentes', async () => {
    const row = page.locator('tr', { hasText: 'Cliente Uno' });
    await row.getByText('Editar datos y límites').click();
    await row.locator('input[name=max_employees]').fill('3');
    await row.getByRole('button', { name: 'Guardar' }).click();
    await expectText(page, 'Organización actualizada');
  }, page);
  await step('Propietario: planes y auditoría de plataforma', async () => {
    await go(page, '/platform/plans'); await expectText(page, 'Planes comerciales'); await expectText(page, 'Sin límite');
    await go(page, '/platform/audit'); await expectText(page, 'Creó organización'); await expectText(page, 'Aplicó plan');
    await shot(page, '04-plataforma-auditoria');
  }, page);
});

// ===================== Administrador central del cliente =====================
await as('admin@e2e.test', async (page) => {
  await step('Admin cliente: solo ve su organización, sin área de plataforma', async () => {
    await expectText(page, 'Cliente Uno');
    if (await page.locator('select[aria-label="Cambiar de área"]').count()) throw new Error('no debería haber selector');
    await go(page, '/platform'); await expectText(page, 'exclusiva del propietario');
    await go(page, '/platform/organizations'); await expectNoText(page, 'Mi Empresa');
  }, page);
  await step('Admin cliente: el límite de empleados se aplica desde el servidor', async () => {
    await go(page, `/employees?org=${C1}`);
    const f = page.locator('form').filter({ has: page.locator('input[name=first_name]') });
    await f.locator('input[name=first_name]').fill('Elena'); await f.locator('input[name=last_name]').fill('Extra');
    await f.locator('select[name=document_type]').selectOption('PASAPORTE');
    await f.locator('input[name=document_number]').fill('X1234567');
    await f.getByRole('button', { name: 'Crear' }).click();
    await expectText(page, 'Límite del plan');
    await shot(page, '05-limite-empleados');
  }, page);
  await step('Admin cliente: ve el motivo de la baja en el expediente', async () => {
    await go(page, `/employees/${BRUNO}?org=${C1}`);
    await expectText(page, 'Historial laboral'); await expectText(page, REASON); await expectText(page, 'Despido');
    await shot(page, '06-expediente-admin');
  }, page);
  await step('Admin cliente: alerta por 3 tardanzas con detalle', async () => {
    await go(page, `/alerts?org=${C1}`);
    await page.getByRole('link', { name: /Tardía, Ana/ }).click();
    await expectText(page, '3 llegadas tarde'); await expectText(page, 'Historial');
    await page.locator('select[name=status]').last().selectOption('reviewed');
    await page.locator('input[name=comment]').fill('Se conversó con la empleada');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expectText(page, 'Seguimiento registrado');
    await shot(page, '07-alerta');
  }, page);
  await step('Admin cliente: configura avisos por correo (sin enviar correos reales)', async () => {
    await go(page, `/alerts?org=${C1}`);
    await page.locator('input[name=email_enabled]').check();
    await page.locator('label', { hasText: 'Admin Cliente' }).locator('input[name=recipient]').check();
    await page.getByRole('button', { name: 'Guardar avisos' }).click();
    await expectText(page, 'Avisos por correo activados');
    const [r] = await sql`select email_enabled, notify_admin_ids::text[] ids from public.alert_rules where organization_id = ${C1}`;
    if (!r.email_enabled || r.ids[0] !== 'e2e00000-0000-4000-8000-0000000000a2') throw new Error(JSON.stringify(r));
  }, page);
  await step('Admin cliente: horario semanal por Excel (plantilla → llenado → carga → vista)', async () => {
    await go(page, `/schedules?org=${C1}&store=${T1}&week=2026-11-23`);
    await expectText(page, 'Semana del');
    const resp = await page.request.get(`${BASE}/api/schedule-template?store=${T1}&week=2026-11-23`);
    if (resp.status() !== 200) throw new Error('plantilla: ' + resp.status());
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await resp.body());
    const ws = wb.getWorksheet('Horario');
    const codes = []; for (let r = 6; r <= ws.rowCount; r++) codes.push(String(ws.getRow(r).getCell(1).value ?? ''));
    if (!codes.includes('C001') || codes.includes('C003')) throw new Error('empleados en la plantilla: ' + codes.join(','));
    const anaRow = 6 + codes.indexOf('C001');
    ws.getCell(`C${anaRow}`).value = '7:30'; ws.getCell(`D${anaRow}`).value = '3:30 pm';
    const file = `${SHOTS}/horario.xlsx`; fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
    await page.locator('input[type=file][name=file]').setInputFiles(file);
    await page.getByRole('button', { name: 'Subir horario' }).click();
    await expectText(page, 'importado: ');
    await go(page, `/schedules?org=${C1}&store=${T1}&week=2026-11-23`);
    await expectText(page, '07:30–15:30');
    await shot(page, '08-horario-semanal');
  }, page);
  await step('Admin cliente: Excel con errores se rechaza indicando fila y día', async () => {
    const resp = await page.request.get(`${BASE}/api/schedule-template?store=${T1}&week=2026-11-30`);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await resp.body());
    wb.getWorksheet('Horario').getCell('C6').value = 'temprano';
    const file = `${SHOTS}/horario-malo.xlsx`; fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
    await page.locator('input[type=file][name=file]').setInputFiles(file);
    await page.getByRole('button', { name: 'Subir horario' }).click();
    await expectText(page, 'no se entiende la hora de entrada «temprano»');
  }, page);
  await step('Admin cliente: reporte de puntualidad con datos reales y exportación Excel', async () => {
    await go(page, `/reports?org=${C1}&type=punctuality&from=2026-10-01&to=2026-10-31`);
    await expectText(page, 'Tardía, Ana');
    const row = page.locator('tr', { hasText: 'Tardía, Ana' });
    const cells = await row.locator('td').allTextContents();
    if (cells[3] !== '3' || cells[4] !== '65') throw new Error('fila: ' + cells.join('|')); // minutos desde las 08:00: 20 + 15 + 30
    const x = await page.request.get(`${BASE}/api/reports?org=${C1}&type=punctuality&from=2026-10-01&to=2026-10-31&format=xlsx`);
    if (x.status() !== 200 || !x.headers()['content-type'].includes('spreadsheetml')) throw new Error('exportación: ' + x.status());
    await shot(page, '09-reporte');
  }, page);
  await step('Admin cliente: permiso de enrolamiento con instrucciones claras', async () => {
    await go(page, `/devices?org=${C1}`);
    await page.locator('tr', { hasText: 'Tel T1' }).getByRole('button', { name: 'Permitir enrolar' }).click();
    await expectText(page, 'Permiso de enrolamiento activado en «Tel T1»'); await expectText(page, 'No hace falta sincronizar');
  }, page);
  await step('Admin cliente: concede acceso de soporte temporal al propietario', async () => {
    await go(page, `/privacy?org=${C1}`);
    await page.locator('input[name=reason]').first().fill('Revisión del horario semanal');
    await page.getByRole('button', { name: 'Conceder acceso' }).click();
    await expectText(page, 'soporte');
  }, page);
});

await as('admin@e2e.test', async (page) => {
  await step('Admin cliente: validación biométrica con tasas, muestra e intervalos (sin porcentajes sueltos)', async () => {
    await go(page, `/biometrics?org=${C1}`);
    await expectText(page, 'Validación biométrica'); await expectText(page, 'EXPERIMENTAL');
    const row = async (label) => (await page.locator('tr', { hasText: label }).first().locator('td').nth(1).textContent()).trim();
    if (!(await row('FRR')).startsWith('1 de 3')) throw new Error('FRR: ' + await row('FRR'));
    if (!(await row('FAR')).startsWith('0 de 1')) throw new Error('FAR: ' + await row('FAR'));
    if (!(await row('BPCER')).startsWith('1 de 4')) throw new Error('BPCER: ' + await row('BPCER'));
    await expectText(page, 'IC 95 %'); await expectText(page, '1000: 3.9');
    await expectText(page, 'Tardía, Ana'); await expectNoText(page, 'NaN');
    await shot(page, '12-validacion-biometrica');
  }, page);
});

// ===================== Supervisora (sin permiso especial) =====================
await as('sup@e2e.test', async (page) => {
  await step('Supervisora: ve el expediente de su tienda pero NO el motivo de la baja', async () => {
    await go(page, `/employees/${BRUNO}?org=${C1}`);
    await expectText(page, 'Historial laboral'); await expectText(page, 'Despido'); await expectText(page, 'Motivo reservado');
    await expectNoText(page, REASON); await expectNoText(page, 'Se entregó carta');
    await shot(page, '10-expediente-supervisora');
  }, page);
  await step('Supervisora: no ve empleados de otra tienda', async () => {
    await go(page, `/employees/${CARLA}?org=${C1}`);
    await expectNoText(page, 'Norte, Carla'); await expectNoText(page, 'Carla Norte');
  }, page);
  await step('Supervisora: no accede a la validación biométrica', async () => {
    await go(page, `/biometrics?org=${C1}`); await expectText(page, 'Sin permiso para ver la validación biométrica');
  }, page);
  await step('Supervisora: ve la alerta de su tienda', async () => {
    await go(page, `/alerts?org=${C1}&status=all`); await expectText(page, 'Tardía, Ana');
  }, page);
});

// ===================== Auditor =====================
await as('aud@e2e.test', async (page) => {
  await step('Auditor: sin motivo de baja (ni en el expediente ni en la auditoría)', async () => {
    await go(page, `/employees/${BRUNO}?org=${C1}`);
    await expectText(page, 'Motivo reservado'); await expectNoText(page, REASON);
    await go(page, `/audit?org=${C1}`); await expectNoText(page, REASON);
  }, page);
  await step('Auditor: consulta la validación biométrica', async () => {
    await go(page, `/biometrics?org=${C1}`); await expectText(page, 'Por tipo de ataque');
  }, page);
  await step('Auditor: solo lectura en horarios (sin formularios de carga)', async () => {
    await go(page, `/schedules?org=${C1}&store=${T1}`);
    if (await page.getByRole('button', { name: 'Subir horario' }).count()) throw new Error('el auditor ve la carga de horarios');
  }, page);
});

// ===================== Permiso especial =====================
await as('admin@e2e.test', async (page) => {
  await step('Admin cliente: concede «ver motivos de baja» a la supervisora', async () => {
    await go(page, `/admins?org=${C1}`);
    const card = page.locator('.card', { hasText: 'Permisos especiales' });
    await card.locator('select[name=user_id]').selectOption({ label: 'Supervisora T1 (sup@e2e.test)' });
    await card.getByRole('button', { name: /Conceder/ }).click();
    await expectText(page, 'Permiso concedido');
  }, page);
});
await as('sup@e2e.test', async (page) => {
  await step('Supervisora con permiso: ahora sí ve el motivo', async () => {
    await go(page, `/employees/${BRUNO}?org=${C1}`); await expectText(page, REASON);
  }, page);
});

// ===================== Soporte =====================
await as('owner@e2e.test', async (page) => {
  await step('Propietario: con soporte concedido ve Cliente Uno como «soporte, solo lectura» y queda auditado', async () => {
    const opts = await page.locator('select[aria-label="Cambiar de área"] option').allTextContents();
    if (!opts.some((o) => o.includes('Cliente Uno') && o.includes('soporte'))) throw new Error('opciones: ' + opts.join(', '));
    await go(page, `/?org=${C1}`);
    await expectText(page, 'Acceso de soporte a Cliente Uno');
    await page.waitForTimeout(1500);
    const [{ n }] = await sql`select count(*)::int n from public.audit_log where organization_id = ${C1} and action = 'support_view'`;
    if (n < 1) throw new Error('sin registro de ingreso de soporte');
    await go(page, `/employees/${BRUNO}?org=${C1}`); await expectNoText(page, REASON);
    await shot(page, '11-soporte');
  }, page);
});

await browser.close();
await sql.end();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    → ${r.err}`}`);
console.log(`\n${results.length - failed.length} de ${results.length} pasos aprobados`);
process.exit(failed.length ? 1 : 0);
