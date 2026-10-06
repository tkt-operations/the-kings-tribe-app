"use client";

import { useRef, useState } from "react";
import { Copy, Link2, Plus, RefreshCw } from "lucide-react";
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
import { displayRequisitionLink } from "@/lib/links";
import { rules, validate } from "@/lib/validation/form";
import { createFormLink, replaceFormLink, revokeFormLink } from "./actions";

interface LinkRow { id: string; label: string; token_hint: string; department: string | null; expires_at: string | null; max_submissions: number | null; submission_count: number; is_active: boolean; revoked_at: string | null; last_used_at: string | null; created_at: string; expired: boolean }

export const COPY_SUCCESS = "Requisition link copied.";
export const COPY_FAILURE = "Requisition link could not be copied. Please try again.";

/** Copies the complete URL; labelled with text, not just an icon. */
export function CopyLinkButton({ url, onCopied }: { url: string; onCopied?: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="primary"
      onClick={async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success(COPY_SUCCESS);
          onCopied?.();
        } catch {
          toast.error(COPY_FAILURE);
        }
      }}
    >
      <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/**
 * Shown once, right after a link is created or replaced: the complete URL with
 * a Copy link action. After this is dismissed the URL cannot be shown again —
 * only a fingerprint is stored.
 */
function NewLinkPanel({ url, note }: { url: string; note?: string }) {
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Copy this link now">
        For security only a fingerprint of the link is stored, so the full link can&rsquo;t be shown again after you close this. If it&rsquo;s lost, use &ldquo;Replace link&rdquo;.
      </Alert>
      {note ? <Alert tone="error">{note}</Alert> : null}
      <Field label="Requisition link" htmlFor="new_link_url">
        <Input readOnly value={url} onFocus={(e) => e.target.select()} className="font-mono text-sm" />
      </Field>
      <CopyLinkButton url={url} />
    </div>
  );
}

export function FormLinks({ links, departments }: { links: LinkRow[]; departments: { id: string; name: string }[] }) {
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState<LinkRow | null>(null);
  const [replacing, setReplacing] = useState<LinkRow | null>(null);
  const [replaced, setReplaced] = useState<{ url: string; label: string; note?: string } | null>(null);
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
            <li key={l.id} className="rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-bold"><Link2 className="size-4 text-navy/50" aria-hidden />{l.label}</p>
                  <p className="break-all font-mono text-[13px] text-navy/70">{displayRequisitionLink(l.token_hint)}</p>
                  <p className="text-sm text-navy/60">
                    {l.department ?? "All departments"} · {l.submission_count} submission{l.submission_count === 1 ? "" : "s"}
                    {l.max_submissions ? ` of ${l.max_submissions}` : ""}{l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Badge tone={active ? "positive" : "negative"}>{active ? "Active" : l.revoked_at ? "Revoked" : expired ? "Expired" : full ? "Limit reached" : "Inactive"}</Badge>
              </div>
              {active ? (
                // Replace (safe) on the left, Revoke (destructive) far right, with a confirmation for both.
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-3">
                  <Button size="sm" variant="secondary" className="h-10" disabled={pending} onClick={() => setReplacing(l)} aria-label={`Replace link for ${l.label}`}>
                    <RefreshCw className="size-4" aria-hidden /> Replace link
                  </Button>
                  <Button size="sm" variant="danger" className="h-10" disabled={pending} onClick={() => setConfirming(l)} aria-label={`Revoke ${l.label}`}>Revoke</Button>
                </div>
              ) : null}
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
      <ConfirmDialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title="Replace requisition link"
        description={replacing ? `“${replacing.label}”: Replacing this link will revoke the current requisition link. Anyone using the old link will no longer be able to submit requests.` : ""}
        confirmLabel="Replace link"
        pendingLabel="Replacing…"
        pending={pending}
        onConfirm={() => replacing && run(() => replaceFormLink(replacing.id), {
          errorMessage: "Unable to replace the link. Please try again.",
          onSuccess: (d) => {
            setReplaced({ url: d.url, label: replacing.label, note: d.oldRevoked ? undefined : "The old link could not be revoked. Revoke it manually." });
            setReplacing(null);
          },
        })}
      />
      <Dialog open={replaced !== null} onClose={() => setReplaced(null)} title="New requisition link" description={replaced ? replaced.label : undefined}>
        {replaced ? <NewLinkPanel url={replaced.url} note={replaced.note} /> : null}
      </Dialog>
    </div>
  );
}

function CreateLink({ departments }: { departments: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ label: "", department_id: "", expires_in_days: "0", max_submissions: "0" });
  const [url, setUrl] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
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
      <Button variant="gold" onClick={() => { setOpen(true); setUrl(null); setV({ label: "", department_id: "", expires_in_days: "0", max_submissions: "0" }); fields.setErrors({}); }}><Plus className="size-4" aria-hidden /> New requisition link</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New requisition link" description="Anyone with the link can submit a requisition — nothing else. Treat it like a key.">
        {url ? (
          <NewLinkPanel url={url} />
        ) : (
          <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <RequiredNote />
            <Field label="Label" htmlFor="fl_label" required error={fields.errors.fl_label} hint="Only staff see this, e.g. “Children’s Ministry leads”."><Input value={v.label} maxLength={120} onChange={(e) => { setV({ ...v, label: e.target.value }); fields.clear("fl_label"); }} /></Field>
            <Field label="Limit to one department" htmlFor="fl_dept">
              <Select value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}>
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
