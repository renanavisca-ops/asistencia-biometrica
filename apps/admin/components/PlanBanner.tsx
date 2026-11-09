'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Status = {
  status: string; access: 'full' | 'read_only'; unlimited: boolean; limit: number | null; enrolled: number; planLabel: string;
  nextPlanLabel: string | null; paidUntil: string | null; suspendedReason: string | null; deletionDueAt: string | null;
  supportUntil: string | null; warnings: string[];
};
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** Avisos del plan de la organización seleccionada (límite, vencimiento, suspensión, eliminación, soporte). */
export function PlanBanner({ orgs, supportOrgs }: { orgs: string[]; supportOrgs: string[] }) {
  const sp = useSearchParams();
  const org = sp.get('org') ?? orgs[0] ?? null;
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    if (!org) return;
    supabaseBrowser().rpc('org_plan_status', { p_org: org }).then(({ data }) => setSt((data as Status) ?? null));
  }, [org]);
  if (!org) return null;
  if (supportOrgs.includes(org)) {
    return <div className="msg" style={{ background: '#eef2ff', color: '#3730a3' }}><b>Modo soporte (solo lectura).</b> Esta organización le concedió acceso temporal. No puede modificar nada; todo lo que consulta queda en la auditoría de la organización.</div>;
  }
  if (!st) return null;
  const w = new Set(st.warnings);
  const msgs: { kind: 'error' | 'warn' | 'info'; text: string }[] = [];
  if (w.has('suspended')) msgs.push({ kind: 'error', text: `Cuenta suspendida${st.suspendedReason ? ` (${st.suspendedReason})` : ''}. El panel está en solo lectura y los teléfonos no registran marcaciones. Puede descargar sus datos o eliminar la cuenta en «Privacidad y cuenta». Comuníquese con el proveedor para reactivarla.` });
  if (w.has('pending_deletion')) msgs.push({ kind: 'error', text: `Eliminación de la cuenta programada: sus datos se borrarán definitivamente el ${d(st.deletionDueAt)}. Hasta entonces puede descargarlos o cancelar la eliminación en «Privacidad y cuenta».` });
  if (w.has('expired')) msgs.push({ kind: 'error', text: `Su membresía (${st.planLabel}) venció el ${d(st.paidUntil)}. El panel está en solo lectura y los teléfonos ya no registran marcaciones hasta renovarla.` });
  if (w.has('expiring_soon')) msgs.push({ kind: 'warn', text: `Su membresía (${st.planLabel}) vence el ${d(st.paidUntil)}. Renuévela para que los teléfonos sigan registrando marcaciones (si su tarjeta venció, actualícela).` });
  if (w.has('at_limit')) msgs.push({ kind: 'warn', text: `Llegó al límite de su plan: ${st.enrolled} de ${st.limit} empleados con rostro registrado (${st.planLabel}). Solo podrá enrolar más empleados con el plan ${st.nextPlanLabel}.` });
  if (w.has('near_limit')) msgs.push({ kind: 'info', text: `Se acerca al límite de su plan: ${st.enrolled} de ${st.limit} empleados con rostro registrado (${st.planLabel}).` });
  if (st.supportUntil) msgs.push({ kind: 'info', text: `Acceso de soporte concedido al proveedor hasta el ${new Date(st.supportUntil).toLocaleString('es')} (solo lectura). Puede retirarlo en «Privacidad y cuenta».` });
  if (!msgs.length) return null;
  return (
    <>
      {msgs.map((m, i) => (
        <div key={i} className={`msg ${m.kind === 'error' ? 'error' : ''}`} style={m.kind === 'warn' ? { background: '#fff4e0', color: '#8a5300' } : m.kind === 'info' ? { background: '#eef6ff', color: '#1d4ed8' } : undefined}>{m.text}</div>
      ))}
    </>
  );
}
