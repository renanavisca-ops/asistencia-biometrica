'use server';
import { supabaseServer } from '@/lib/supabase/server';
import { back, s } from '@/lib/actions';

export async function followup(fd: FormData) {
  const sb = await supabaseServer();
  const id = s(fd, 'alert_id')!;
  const { error } = await sb.rpc('alert_followup', { p_alert_id: id, p_status: s(fd, 'status'), p_comment: s(fd, 'comment') ?? '' });
  back('/alerts', fd, error, 'Seguimiento registrado', { id });
}

export async function saveRules(fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_alert_rules', {
    p_org: s(fd, 'org'), p_enabled: fd.get('enabled') === 'on', p_threshold: Number(s(fd, 'threshold') ?? 3), p_notify: null,
  });
  back('/alerts', fd, error, 'Regla guardada. Recalcule en Horarios para aplicarla a meses ya evaluados.');
}

export async function saveNotifications(fd: FormData) {
  const sb = await supabaseServer();
  const recipients = fd.getAll('recipient').map(String).filter(Boolean);
  const { error } = await sb.rpc('set_alert_notifications', { p_org: s(fd, 'org'), p_enabled: fd.get('email_enabled') === 'on', p_recipients: recipients });
  back('/alerts', fd, error, fd.get('email_enabled') === 'on' ? 'Avisos por correo activados' : 'Avisos por correo desactivados');
}
