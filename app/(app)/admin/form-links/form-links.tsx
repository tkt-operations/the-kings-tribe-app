"use client";

import { useState } from "react";
import { Copy, Link2, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { createFormLink, revokeFormLink } from "./actions";

interface LinkRow { id: string; label: string; token_hint: string; department: string | null; expires_at: string | null; max_submissions: number | null; submission_count: number; is_active: boolean; revoked_at: string | null; last_used_at: string | null; created_at: string; expired: boolean }

export function FormLinks({ links, departments }: { links: LinkRow[]; departments: { id: string; name: string }[] }) {
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><CreateLink departments={departments} /></div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-3">
        {links.length === 0 ? <li className="rounded-[var(--radius-card)] bg-white p-6 text-sm text-navy/60 ring-1 ring-navy/10">No links yet. Create one and send it to your department leads.</li> : null}
        {links.map((l) => {
          const expired = l.expired;
          const full = l.max_submissions ? l.submission_count >= l.max_submissions : false;
          const active = l.is_active && !l.revoked_at && !expired && !full;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold"><Link2 className="size-4 text-navy/50" aria-hidden />{l.label}</p>
                <p className="text-sm text-navy/60">
                  …/request/{l.token_hint}••• · {l.department ?? "All departments"} · {l.submission_count} submission{l.submission_count === 1 ? "" : "s"}
                  {l.max_submissions ? ` of ${l.max_submissions}` : ""}{l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={active ? "positive" : "negative"}>{active ? "Active" : l.revoked_at ? "Revoked" : expired ? "Expired" : full ? "Limit reached" : "Inactive"}</Badge>
                {active ? <Button size="sm" variant="danger" className="h-10" disabled={pending} onClick={() => { if (window.confirm(`Revoke “${l.label}”? Anyone using it will no longer be able to submit.`)) run(() => revokeFormLink(l.id)); }}>Revoke</Button> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreateLink({ departments }: { departments: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ label: "", department_id: "", expires_in_days: "0", max_submissions: "0" });
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <>
      <Button variant="gold" onClick={() => { setOpen(true); setUrl(null); setCopied(false); }}><Plus className="size-4" aria-hidden /> New requisition link</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New requisition link" description="Anyone with the link can submit a requisition — nothing else. Treat it like a key.">
        {url ? (
          <div className="space-y-4">
            <Alert tone="warning" title="Copy this link now">For security only a fingerprint of the link is stored. If you lose it, revoke it and create a new one.</Alert>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Requisition link" className="font-mono text-sm" />
            <Button onClick={async () => { await navigator.clipboard?.writeText(url); setCopied(true); }}><Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy link"}</Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => createFormLink({ label: v.label, department_id: v.department_id || null, expires_in_days: Number(v.expires_in_days) || 0, max_submissions: Number(v.max_submissions) || 0 }), (d) => setUrl(d.url)); }}>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Field label="Label" htmlFor="fl_label" hint="Only staff see this, e.g. “Children’s Ministry leads”."><Input id="fl_label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} required /></Field>
            <Field label="Limit to one department" htmlFor="fl_dept">
              <Select id="fl_dept" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}>
                <option value="">Any department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expires after (days)" htmlFor="fl_exp" hint="0 = never"><Input id="fl_exp" inputMode="numeric" value={v.expires_in_days} onChange={(e) => setV({ ...v, expires_in_days: e.target.value.replace(/\D/g, "") })} /></Field>
              <Field label="Max submissions" htmlFor="fl_max" hint="0 = unlimited"><Input id="fl_max" inputMode="numeric" value={v.max_submissions} onChange={(e) => setV({ ...v, max_submissions: e.target.value.replace(/\D/g, "") })} /></Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? <Spinner /> : null}Create link</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
