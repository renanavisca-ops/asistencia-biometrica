'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { registerDocument } from '../hr-actions';

const MAX = 10 * 1024 * 1024;

/** Sube el archivo directamente al almacenamiento privado (sin pasar por el servidor del panel) y luego lo registra. */
export function DocUpload({ orgId, employeeId }: { orgId: string; employeeId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fileRef.current?.files?.[0];
    if (!file) return setMsg({ ok: false, text: 'Seleccione un archivo.' });
    if (file.size > MAX) return setMsg({ ok: false, text: 'El archivo supera 10 MB.' });
    setBusy(true); setMsg(null);
    const safe = file.name.normalize('NFD').replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${orgId}/${employeeId}/${crypto.randomUUID()}-${safe}`;
    const sb = supabaseBrowser();
    const up = await sb.storage.from('hr-documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (up.error) { setBusy(false); return setMsg({ ok: false, text: `No se pudo subir: ${up.error.message}` }); }
    const r = await registerDocument({ employeeId, relatedType: String(fd.get('related_type') ?? 'general'), docType: String(fd.get('doc_type') ?? ''),
      fileName: file.name, path, size: file.size, mime: file.type });
    setBusy(false);
    if ('error' in r && r.error) return setMsg({ ok: false, text: r.error });
    form.reset();
    setMsg({ ok: true, text: 'Documento guardado.' });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="inline" style={{ marginTop: 10 }}>
      <label>Tipo de documento<input name="doc_type" required minLength={2} placeholder="p. ej. carta de renuncia, contrato" /></label>
      <label>Relacionado con<select name="related_type" defaultValue="general">
        <option value="general">General</option><option value="hire">Contratación</option><option value="termination">Salida</option><option value="disciplinary">Disciplina</option>
      </select></label>
      <label>Archivo (máx. 10 MB)<input ref={fileRef} type="file" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" /></label>
      <button disabled={busy}>{busy ? 'Subiendo…' : 'Subir documento'}</button>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`} style={{ width: '100%', margin: 0 }}>{msg.text}</div>}
    </form>
  );
}
