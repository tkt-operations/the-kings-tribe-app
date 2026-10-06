"use client";

import { useRef, useState } from "react";
import { Copy, Link2, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, RequiredNote, Select } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/ui/use-action";
import { rules, validate } from "@/lib/validation/form";
import { createFormLink, revokeFormLink } from "./actions";

interface LinkRow { id: string; label: string; token_hint: string; department: string | null; expires_at: string | null; max_submissions: number | null; submission_count: number; is_active: boolean; revoked_at: string | null; last_used_at: string | null; created_at: string; expired: boolean }

export function FormLinks({ links, departments }: { links: LinkRow[]; departments: { id: string; name: string }[] }) {
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState<LinkRow | null>(null);
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
                {active ? <Button size="sm" variant="danger" className="h-10" disabled={pending} onClick={() => setConfirming(l)}>Revoke</Button> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Revoke requisition link"
        description={confirming ? `Revoke “${confirming.label}”? Anyone using it will no longer be able to submit.` : ""}
        confirmLabel="Revoke link"
        pendingLabel="Revoking…"
        danger
        pending={pending}
        onConfirm={() => confirming && run(() => revokeFormLink(confirming.id), { successMessage: "Requisition link revoked successfully.", onSuccess: () => setConfirming(null) })}
      />
    </div>
  );
}

function CreateLink({ departments }: { departments: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ label: "", department_id: "", expires_in_days: "0", max_submissions: "0" });
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const numberRule = (max: number, message: string) => (x: string) => (x !== "" && Number(x) > max ? message : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate({
      fl_label: [v.label, rules.required("Label is required."), rules.minLength(2, "Use at least 2 characters for the label.")],
      fl_exp: [v.expires_in_days, numberRule(3650, "Use 3650 days or fewer.")],
      fl_max: [v.max_submissions, numberRule(100000, "Use 100,000 or fewer.")],
    });
    if (!fields.check(errors, formRef.current)) return;
    run(
      () => createFormLink({ label: v.label, department_id: v.department_id || null, expires_in_days: Number(v.expires_in_days) || 0, max_submissions: Number(v.max_submissions) || 0 }),
      { successMessage: "Requisition link created successfully.", errorMessage: "Unable to create the link. Please try again.", onSuccess: (d) => setUrl(d.url) },
    );
  }
  return (
    <>
      <Button variant="gold" onClick={() => { setOpen(true); setUrl(null); setCopied(false); }}><Plus className="size-4" aria-hidden /> New requisition link</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New requisition link" description="Anyone with the link can submit a requisition — nothing else. Treat it like a key.">
        {url ? (
          <div className="space-y-4">
            <Alert tone="warning" title="Copy this link now">For security only a fingerprint of the link is stored. If you lose it, revoke it and create a new one.</Alert>
            <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Requisition link" className="font-mono text-sm" />
            <Button onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                toast.success("Link copied to the clipboard.");
              } catch {
                toast.error("Unable to copy automatically. Select the link and copy it manually.");
              }
            }}><Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy link"}</Button>
          </div>
        ) : (
          <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <RequiredNote />
            <Field label="Label" htmlFor="fl_label" required error={fields.errors.fl_label} hint="Only staff see this, e.g. “Children’s Ministry leads”."><Input value={v.label} maxLength={120} onChange={(e) => { setV({ ...v, label: e.target.value }); fields.clear("fl_label"); }} /></Field>
            <Field label="Limit to one department" htmlFor="fl_dept">
              <Select id="fl_dept" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}>
                <option value="">Any department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expires after (days)" htmlFor="fl_exp" error={fields.errors.fl_exp} hint="0 = never"><Input inputMode="numeric" value={v.expires_in_days} onChange={(e) => { setV({ ...v, expires_in_days: e.target.value.replace(/\D/g, "") }); fields.clear("fl_exp"); }} /></Field>
              <Field label="Max submissions" htmlFor="fl_max" error={fields.errors.fl_max} hint="0 = unlimited"><Input inputMode="numeric" value={v.max_submissions} onChange={(e) => { setV({ ...v, max_submissions: e.target.value.replace(/\D/g, "") }); fields.clear("fl_max"); }} /></Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" pending={pending} pendingLabel="Creating…">Create link</LoadingButton>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
