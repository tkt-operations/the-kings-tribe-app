"use client";

import { useRef, useState } from "react";
import { Banknote } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate } from "@/lib/validation/form";
import { recordDisbursement } from "./actions";

export function DisbursementDialog({ requisitionId, remaining, workflow }: { requisitionId: string; remaining: string; workflow: string }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [v, setV] = useState({ amount: "", method: workflow === "petty_cash" ? "cash" : "check", paid_on: iso, reference: "", notes: "" });
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, run } = useAction();
  const label = workflow === "reimbursement" ? "Record reimbursement" : workflow === "petty_cash" ? "Record cash given" : "Record check issued";
  const set = (key: keyof typeof v, id: string | null) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV({ ...v, [key]: e.target.value });
    if (id) fields.clear(id);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate({
      db_amount: [v.amount, rules.required("Amount is required."), rules.positiveMoney()],
      db_method: [v.method, rules.required("Choose a payment method.")],
      db_date: [v.paid_on, rules.required("Date paid is required."), rules.date(), rules.notAfter(iso, "The payment date can't be in the future.")],
    });
    if (!fields.check(errors, formRef.current)) return;
    run(() => recordDisbursement(requisitionId, { ...v, method: v.method as "cash" | "check" | "bank_transfer" | "other" }), {
      errorMessage: "Unable to record the disbursement. Please try again.",
      onSuccess: () => setOpen(false),
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Banknote className="size-4" aria-hidden /> {label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} description={`Up to ${remaining} remains within the approved amount.`}>
        <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="db_amount" required error={fields.errors.db_amount}><Input inputMode="decimal" className="tabular" placeholder="0.00" value={v.amount} onChange={set("amount", "db_amount")} /></Field>
            <Field label="Method" htmlFor="db_method" required error={fields.errors.db_method}>
              <Select value={v.method} onChange={set("method", "db_method")}>
                <option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Date paid" htmlFor="db_date" required error={fields.errors.db_date}><Input type="date" max={iso} value={v.paid_on} onChange={set("paid_on", "db_date")} /></Field>
            <Field label="Check # / reference" htmlFor="db_ref"><Input value={v.reference} maxLength={120} onChange={set("reference", null)} /></Field>
          </div>
          <Field label="Notes" htmlFor="db_notes"><Textarea rows={2} value={v.notes} maxLength={2000} onChange={set("notes", null)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Save</LoadingButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
