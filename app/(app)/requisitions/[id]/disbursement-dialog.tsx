"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { recordDisbursement } from "./actions";

export function DisbursementDialog({ requisitionId, remaining, workflow }: { requisitionId: string; remaining: string; workflow: string }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [v, setV] = useState({ amount: "", method: workflow === "petty_cash" ? "cash" : "check", paid_on: iso, reference: "", notes: "" });
  const { pending, error, run } = useAction();
  const label = workflow === "reimbursement" ? "Record reimbursement" : workflow === "petty_cash" ? "Record cash given" : "Record check issued";
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Banknote className="size-4" aria-hidden /> {label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} description={`Up to ${remaining} remains within the approved amount.`}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => recordDisbursement(requisitionId, { ...v, method: v.method as "cash" | "check" | "bank_transfer" | "other" }), () => setOpen(false)); }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="db_amount" required><Input id="db_amount" inputMode="decimal" className="tabular" placeholder="0.00" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} required /></Field>
            <Field label="Method" htmlFor="db_method">
              <Select id="db_method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                <option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Date paid" htmlFor="db_date" required><Input id="db_date" type="date" max={iso} value={v.paid_on} onChange={(e) => setV({ ...v, paid_on: e.target.value })} required /></Field>
            <Field label="Check # / reference" htmlFor="db_ref"><Input id="db_ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
          </div>
          <Field label="Notes" htmlFor="db_notes"><Textarea id="db_notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? <Spinner /> : null}Save</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
