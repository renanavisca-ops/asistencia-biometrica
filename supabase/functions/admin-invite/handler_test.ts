import { createInviteHandler, type InviteDeps } from './handler.ts';

const ORG = '11111111-0000-4000-8000-000000000001';
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
function deps(over: Partial<InviteDeps> = {}) {
  const calls: string[] = [];
  const d: InviteDeps = {
    canInvite: async () => ({ ok: true, callerId: 'caller' }),
    findUser: async () => null,
    generateInvite: async (e) => { calls.push('invite:' + e); return { userId: 'new-user', link: 'https://x/verify?token=t' }; },
    register: async (p) => { calls.push(`register:${p.userId}:${p.role}:${p.org}`); },
    ...over,
  };
  return { d, calls };
}
const req = (body: unknown, auth = 'Bearer tok') => new Request('https://f/admin-invite', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
const ok = { email: ' Ana@Empresa.com ', name: 'Ana', role: 'central_admin', organizationId: ORG, redirectTo: 'https://panel.example.com/auth/accept' };

Deno.test('sin token → 401', async () => {
  const r = await createInviteHandler(deps().d)(req(ok, ''));
  assert(r.status === 401, 'status');
});
Deno.test('sin permiso → 403 y no crea nada', async () => {
  const { d, calls } = deps({ canInvite: async () => ({ ok: false, callerId: 'c' }) });
  const r = await createInviteHandler(d)(req(ok));
  assert(r.status === 403 && calls.length === 0, 'debe rechazar sin efectos');
});
Deno.test('invitación válida → enlace y registro con correo normalizado', async () => {
  const { d, calls } = deps();
  const r = await createInviteHandler(d)(req(ok));
  const j = await r.json();
  assert(r.status === 200 && j.link && !j.existing, JSON.stringify(j));
  assert(calls[0] === 'invite:ana@empresa.com' && calls[1] === `register:new-user:central_admin:${ORG}`, calls.join());
});
Deno.test('usuario existente → solo se asigna el rol (sin enlace)', async () => {
  const { d, calls } = deps({ findUser: async () => 'existing' });
  const j = await (await createInviteHandler(d)(req(ok))).json();
  assert(j.existing === true && j.link === null && calls.length === 1 && calls[0]!.startsWith('register:existing'), calls.join());
});
Deno.test('validaciones: rol, correo, retorno', async () => {
  const h = createInviteHandler(deps().d);
  assert((await h(req({ ...ok, role: 'supervisor' }))).status === 400, 'rol');
  assert((await h(req({ ...ok, email: 'no-es-correo' }))).status === 400, 'correo');
  assert((await h(req({ ...ok, redirectTo: 'https://evil.com/x' }))).status === 400, 'retorno');
  assert((await h(req({ ...ok, organizationId: null }))).status === 400, 'organización');
});
