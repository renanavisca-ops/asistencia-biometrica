// Edge Function: invitación de administradores (verify_jwt = true).
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { createInviteHandler } from './handler.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20 });
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createInviteHandler({
  async canInvite(authHeader, org, role) {
    // Con la sesión de quien invita: PostgREST valida el token y aplica MFA/permisos en la función.
    const caller = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: u } = await caller.auth.getUser(authHeader.slice(7));
    const { data, error } = await caller.rpc('can_invite_admin', { p_org: org, p_role: role });
    if (error) return { ok: false, callerId: null, error: error.message };
    return { ok: data === true, callerId: u.user?.id ?? null };
  },
  async findUser(email) {
    const [r] = await sql`select id from auth.users where lower(email) = ${email} limit 1`;
    return r?.id ?? null;
  },
  async generateInvite(email, redirectTo) {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
    if (error || !data.user) throw new Error(error?.message ?? 'generateLink sin usuario');
    return { userId: data.user.id, link: data.properties.action_link };
  },
  async register(p) {
    await sql`select private.register_invited_admin(${p.userId}::uuid, ${p.name}, ${p.email}, ${p.role}::public.role_code, ${p.org}::uuid, ${p.invitedBy}::uuid)`;
  },
}, (m, e) => console.error(m, JSON.stringify(e))));
