export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.error) return <div className="msg error">{sp.error}</div>;
  if (sp.ok) return <div className="msg ok">{sp.ok}</div>;
  return null;
}
export function OrgField({ org }: { org: string | undefined }) {
  return <input type="hidden" name="org" value={org ?? ''} />;
}
export type SP = Promise<Record<string, string | undefined>>;
