"use client";

import { useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate } from "@/lib/validation/form";
import { formatMoney } from "@/lib/money";
import { WORKFLOW_LABELS, type WorkflowKind } from "@/lib/workflow/request-types";
import { saveRequestType } from "./actions";

export interface RequestTypeRow {
  id: string; key: string; name: string; description: string | null; help_text: string | null; workflow: WorkflowKind;
  is_active: boolean; is_default: boolean; requires_receipt_on_submission: boolean; requires_purchase_details: boolean;
  requires_cost_center: boolean; issues_purchase_order: boolean; allows_vendor_orders: boolean; requires_disbursement: boolean; max_total: string | null;
}

const PRESETS: Record<WorkflowKind, Partial<RequestTypeRow>> = {
  church_order: { issues_purchase_order: true, allows_vendor_orders: true, requires_disbursement: false, requires_receipt_on_submission: false, requires_purchase_details: false },
  purchase_order: { issues_purchase_order: true, allows_vendor_orders: false, requires_disbursement: false, requires_receipt_on_submission: false, requires_purchase_details: false },
  reimbursement: { issues_purchase_order: false, allows_vendor_orders: false, requires_disbursement: true, requires_receipt_on_submission: true, requires_purchase_details: true },
  petty_cash: { issues_purchase_order: false, allows_vendor_orders: false, requires_disbursement: true, requires_receipt_on_submission: false, requires_purchase_details: false },
  advance_check: { issues_purchase_order: false, allows_vendor_orders: false, requires_disbursement: true, requires_receipt_on_submission: false, requires_purchase_details: false },
};

const FLAGS: [keyof RequestTypeRow, string][] = [
  ["requires_receipt_on_submission", "Receipt upload required when submitting"],
  ["requires_purchase_details", "Actual amount, vendor and purchase date required"],
  ["requires_cost_center", "Budget line / cost center required"],
  ["issues_purchase_order", "Finance issues a Purchase Order after approval"],
  ["allows_vendor_orders", "Finance records vendor orders (church purchases)"],
  ["requires_disbursement", "Funds are paid out (reimbursement, cash or check)"],
];

export function RequestTypeAdmin({ types, currency }: { types: RequestTypeRow[]; currency: string }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><EditDialog currency={currency} /></div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {types.map((t) => (
          <li key={t.id} className="rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-navy/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-2xl">{t.name}</p>
                <p className="text-sm text-navy/60">{WORKFLOW_LABELS[t.workflow]}</p>
              </div>
              <EditDialog type={t} currency={currency} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.is_default ? <Badge tone="info">Default</Badge> : null}
              {!t.is_active ? <Badge>Inactive</Badge> : null}
              {t.max_total ? <Badge tone="attention">Limit {formatMoney(t.max_total, currency)}</Badge> : null}
            </div>
            {t.description ? <p className="mt-3 text-sm text-navy/75">{t.description}</p> : null}
            <ul className="mt-3 space-y-1 text-[13px] text-navy/70">
              {FLAGS.filter(([k]) => t[k]).map(([k, label]) => <li key={k}>• {label}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditDialog({ type, currency }: { type?: RequestTypeRow; currency: string }) {
  const blank: RequestTypeRow = { id: "", key: "", name: "", description: "", help_text: "", workflow: "church_order", is_active: true, is_default: false, max_total: "", requires_cost_center: false, ...PRESETS.church_order } as RequestTypeRow;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<RequestTypeRow>(type ?? blank);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, run } = useAction();
  return (
    <>
      {type ? (
        <Button size="sm" variant="ghost" className="h-10" onClick={() => { setV(type); fields.setErrors({}); setOpen(true); }} aria-label={`Edit ${type.name}`}><Pencil className="size-4" aria-hidden /></Button>
      ) : (
        <Button variant="gold" onClick={() => { setV(blank); fields.setErrors({}); setOpen(true); }}><Plus className="size-4" aria-hidden /> New request type</Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={type ? `Edit ${type.name}` : "New request type"} description="Rules here are enforced by the database when requests are submitted and processed.">
        <form ref={formRef} className="space-y-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const errors = validate({
            rt_name: [v.name, rules.required("Name is required."), rules.minLength(2, "Use at least 2 characters.")],
            rt_max: [v.max_total ?? "", rules.positiveMoney("Enter a spending limit greater than $0, or leave it blank.")],
          });
          if (!fields.check(errors, formRef.current)) return;
          run(() => saveRequestType(type?.id ?? null, {
            name: v.name, description: v.description ?? "", help_text: v.help_text ?? "", workflow: v.workflow, is_active: v.is_active, is_default: v.is_default,
            requires_receipt_on_submission: v.requires_receipt_on_submission, requires_purchase_details: v.requires_purchase_details, requires_cost_center: v.requires_cost_center,
            issues_purchase_order: v.issues_purchase_order, allows_vendor_orders: v.allows_vendor_orders, requires_disbursement: v.requires_disbursement, max_total: v.max_total ?? "",
          }), { successMessage: "Request type saved successfully.", errorMessage: "Unable to save the request type. Please try again.", onSuccess: () => setOpen(false) });
        }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <Field label="Name" htmlFor="rt_name" required error={fields.errors.rt_name}><Input value={v.name} maxLength={80} onChange={(e) => { setV({ ...v, name: e.target.value }); fields.clear("rt_name"); }} /></Field>
          <Field label="Workflow" htmlFor="rt_workflow" required hint="Decides what happens after approval.">
            <Select value={v.workflow} disabled={Boolean(type)} onChange={(e) => { const w = e.target.value as WorkflowKind; setV({ ...v, workflow: w, ...PRESETS[w] }); }}>
              {(Object.keys(WORKFLOW_LABELS) as WorkflowKind[]).map((k) => <option key={k} value={k}>{WORKFLOW_LABELS[k]}</option>)}
            </Select>
          </Field>
          <Field label="Description (shown to requesters)" htmlFor="rt_desc"><Textarea id="rt_desc" rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <Field label="Guidance when selected" htmlFor="rt_help"><Textarea id="rt_help" rows={2} value={v.help_text ?? ""} onChange={(e) => setV({ ...v, help_text: e.target.value })} /></Field>
          <Field label={`Spending limit (${currency}, optional)`} htmlFor="rt_max" error={fields.errors.rt_max}><Input inputMode="decimal" value={v.max_total ?? ""} onChange={(e) => { setV({ ...v, max_total: e.target.value }); fields.clear("rt_max"); }} placeholder="No limit" /></Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Rules</legend>
            {FLAGS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-3 text-sm"><Checkbox checked={Boolean(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{label}</label>
            ))}
            <label className="flex items-center gap-3 text-sm"><Checkbox checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />Active (offered on the form)</label>
            <label className="flex items-center gap-3 text-sm"><Checkbox checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} />Default selection</label>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Save</LoadingButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
