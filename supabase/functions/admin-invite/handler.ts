/**
 * Invitación de administradores (verify_jwt = true: la pasarela de Supabase valida el token de quien invita).
 * 1) Comprueba el permiso CON LA SESIÓN de quien invita (RPC can_invite_admin: MFA + admin.manage / superadmin).
 * 2) Crea el usuario en Auth y genera un enlace de invitación (no envía correo: el panel muestra el enlace para
 *    compartirlo; el correo gratuito de Supabase solo entrega a miembros del equipo y tiene un límite muy bajo).
 * 3) Registra la cuenta de administrador y su rol (private.register_invited_admin) y lo audita.
 * La clave service_role solo existe aquí (servidor); nunca llega al navegador ni al teléfono.
 */
export interface InviteDeps {
  canInvite(authHeader: string, org: string | null, role: string): Promise<{ ok: boolean; callerId: string | null; error?: string }>;
  findUser(email: string): Promise<string | null>;
  generateInvite(email: string, redirectTo: string): Promise<{ userId: string; link: string }>;
  register(p: { userId: string; name: string; email: string; role: string; org: string | null; invitedBy: string }): Promise<void>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['central_admin', 'superadmin'];

export function createInviteHandler(deps: InviteDeps, log: (m: string, e?: unknown) => void = () => {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { error: 'unauthorized' });
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
    const email = String(b.email ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim().slice(0, 80);
    const role = String(b.role ?? 'central_admin');
    const org = b.organizationId ? String(b.organizationId) : null;
    const redirectTo = String(b.redirectTo ?? '');
    if (!EMAIL_RE.test(email) || email.length > 120) return json(400, { error: 'Correo no válido' });
    if (name.length < 2) return json(400, { error: 'Escriba el nombre de la persona' });
    if (!ROLES.includes(role)) return json(400, { error: 'Rol no permitido' });
    if (role !== 'superadmin' && (!org || !UUID_RE.test(org))) return json(400, { error: 'Elija la organización' });
    if (!/^https:\/\/[^/]+\/auth\/accept$/.test(redirectTo)) return json(400, { error: 'Dirección de retorno no válida' });
    try {
      const perm = await deps.canInvite(auth, role === 'superadmin' ? null : org, role);
      if (!perm.ok || !perm.callerId) return json(403, { error: perm.error ?? 'Sin permiso para invitar con ese rol en esa organización' });
      const existing = await deps.findUser(email);
      if (existing) {
        await deps.register({ userId: existing, name, email, role, org, invitedBy: perm.callerId });
        return json(200, { ok: true, existing: true, link: null });
      }
      const inv = await deps.generateInvite(email, redirectTo);
      await deps.register({ userId: inv.userId, name, email, role, org, invitedBy: perm.callerId });
      return json(200, { ok: true, existing: false, link: inv.link });
    } catch (e) {
      log('admin-invite error', { msg: e instanceof Error ? e.message : String(e) });
      return json(500, { error: 'No se pudo crear la invitación. Intente de nuevo.' });
    }
  };
}
