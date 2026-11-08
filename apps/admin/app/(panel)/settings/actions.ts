'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

const NUM = ['antiDoubleWindowSec', 'longSessionHours', 'staleSessionHours', 'offlineMaxHours', 'leaseHours', 'serverTimeStaleHours', 'maxFailedAttempts', 'cooldownSec', 'confirmationSec'] as const;
const OPT = ['matchThreshold', 'matchMargin', 'padThreshold'] as const;

export async function createPolicy(fd: FormData) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const org = s(fd, 'org')!;
  const { data: last } = await sb.from('device_policy_versions').select('version').eq('organization_id', org).order('version', { ascending: false }).limit(1).maybeSingle();
  const policy: Record<string, number | null> = {};
  for (const k of NUM) policy[k] = Number(s(fd, k));
  // Umbrales biométricos vacíos = sin calibrar: la app se niega a reconocer.
  for (const k of OPT) policy[k] = s(fd, k) == null ? null : Number(s(fd, k));
  const bad = Object.entries(policy).find(([, v]) => v !== null && !Number.isFinite(v));
  if (bad) back('/settings', fd, { message: `Valor inválido en ${bad[0]}` }, '');
  if (policy.staleSessionHours! <= policy.longSessionHours!) back('/settings', fd, { message: 'La caducidad de sesión debe ser mayor que la sesión larga' }, '');
  const { error } = await sb.from('device_policy_versions').insert({ organization_id: org, version: (last?.version ?? 0) + 1, policy, created_by: user?.id });
  back('/settings', fd, error, 'Nueva versión de política creada; los teléfonos la reciben en su próxima sincronización');
}
