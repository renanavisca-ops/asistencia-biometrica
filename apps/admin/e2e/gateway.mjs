// Pasarela local para la prueba de navegador del panel: imita la URL de Supabase.
//   /rest/v1/*    → PostgREST real (con las migraciones reales y RLS).
//   /auth/v1/*    → sesiones mínimas: inicio con contraseña de prueba, JWT HS256 con aal2 (MFA ya superado), /user, logout.
//   /storage/v1/* → subida, URL firmadas y descarga; los permisos se comprueban con las políticas RLS reales de
//                   storage.objects (se inserta/lee la fila como el usuario autenticado).
// Solo para pruebas locales: no hay secretos reales ni conexión con producción.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const PORT = Number(process.env.GW_PORT ?? 54321);
const REST = process.env.REST_URL ?? 'http://127.0.0.1:3001';
const SECRET = process.env.JWT_SECRET;
const PASSWORD = 'Prueba-E2E-1234';
const FILES = process.env.FILES_DIR ?? '/tmp/panel-e2e-files';
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} });
fs.mkdirSync(FILES, { recursive: true });

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export const sign = (payload) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const verify = (tok) => {
  const [h, p, s] = String(tok ?? '').split('.');
  if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  return c.exp && c.exp * 1000 > Date.now() ? c : null;
};
const userObj = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(),
  factors: [{ id: 'f-' + u.id, status: 'verified', factor_type: 'totp', friendly_name: 'e2e' }] });
const session = (u) => {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', aal: 'aal2', amr: [{ method: 'password', timestamp: now }, { method: 'totp', timestamp: now }],
    session_id: crypto.randomUUID(), iat: now, exp: now + 8 * 3600 });
  return { access_token: access, token_type: 'bearer', expires_in: 8 * 3600, expires_at: now + 8 * 3600, refresh_token: b64({ id: u.id, email: u.email }), user: userObj(u) };
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  'access-control-expose-headers': 'content-range,content-profile,x-total-count' };
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const claimsOf = (req) => verify((req.headers.authorization ?? '').replace(/^Bearer /i, ''));
/** Ejecuta fn como el usuario (rol authenticated + claims): aplica las políticas RLS reales. */
const asUser = (claims, fn) => sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await tx.unsafe('set local role authenticated');
  return fn(tx);
});

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204);
    // ---------- REST → PostgREST ----------
    if (url.pathname.startsWith('/rest/v1')) {
      const body = await readBody(req);
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
      const r = await fetch(REST + url.pathname.slice('/rest/v1'.length) + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) h[k] = v; });
      return send(res, r.status, out, h);
    }
    // ---------- Auth ----------
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      let email = b.email;
      if (url.searchParams.get('grant_type') === 'refresh_token') { try { email = JSON.parse(Buffer.from(b.refresh_token, 'base64url')).email; } catch { email = null; } }
      else if (b.password !== PASSWORD) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
      const [u] = await sql`select id::text, email from auth.users where lower(email) = lower(${email ?? ''})`;
      if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
      return send(res, 200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const c = claimsOf(req);
      if (!c) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return send(res, 200, userObj({ id: c.sub, email: c.email }));
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname.startsWith('/auth/v1/factors')) return send(res, 200, { all: [], totp: [], phone: [] });
    // ---------- Storage ----------
    const m = url.pathname.match(/^\/storage\/v1\/object\/(sign\/)?([^/]+)\/?(.*)$/);
    if (m) {
      const [, isSign, bucket, rawPath] = m; const p = decodeURIComponent(rawPath);
      if (isSign && req.method === 'GET') { // descarga con URL firmada
        const tok = verify(url.searchParams.get('token'));
        if (!tok || tok.url !== `${bucket}/${p}`) return send(res, 400, { error: 'InvalidSignature' });
        return send(res, 200, fs.readFileSync(path.join(FILES, bucket, p)), { 'content-type': 'application/octet-stream' });
      }
      const c = claimsOf(req);
      if (!c || c.role !== 'authenticated') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'sin sesión' });
      if (isSign && req.method === 'POST') { // URL firmadas: solo si la política de lectura lo permite
        const b = JSON.parse((await readBody(req)).toString());
        const paths = b.paths ?? [p];
        const visible = await asUser(c, (tx) => tx`select name from storage.objects where bucket_id = ${bucket} and name = any(${paths})`);
        const ok = new Set(visible.map((r) => r.name));
        const now = Math.floor(Date.now() / 1000);
        const out = paths.map((x) => ok.has(x)
          ? { path: x, signedURL: `/object/sign/${bucket}/${x.split('/').map(encodeURIComponent).join('/')}?token=${sign({ url: `${bucket}/${x}`, exp: now + (b.expiresIn ?? 60) })}`, error: null }
          : { path: x, signedURL: null, error: 'Either the object does not exist or you do not have access to it' });
        return send(res, 200, b.paths ? out : { signedURL: out[0].signedURL });
      }
      if (req.method === 'POST' || req.method === 'PUT') { // subida: la política de inserción decide
        const body = await readBody(req);
        try { await asUser(c, (tx) => tx`insert into storage.objects (bucket_id, name, owner) values (${bucket}, ${p}, ${c.sub})`); }
        catch (e) { return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy: ' + e.message }); }
        fs.mkdirSync(path.dirname(path.join(FILES, bucket, p)), { recursive: true });
        fs.writeFileSync(path.join(FILES, bucket, p), body);
        return send(res, 200, { Key: `${bucket}/${p}`, Id: crypto.randomUUID() });
      }
    }
    if (url.pathname.startsWith('/functions/v1/')) return send(res, 501, { error: 'funciones no disponibles en la prueba local' });
    return send(res, 404, { error: 'not found: ' + url.pathname });
  } catch (e) {
    console.error('gateway', e);
    return send(res, 500, { error: String(e?.message ?? e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log('gateway ready on', PORT));
