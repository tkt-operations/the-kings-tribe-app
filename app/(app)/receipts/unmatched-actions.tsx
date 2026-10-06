"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate } from "@/lib/validation/form";
import { assignUnmatchedReceipt, rejectUnmatchedReceipt } from "./actions";

const REQUISITION_NUMBER = /^TKT-REQ-\d{4}-\d{4,}$/i;

export function UnmatchedActions({ receiptId }: { receiptId: string }) {
  const [number, setNumber] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const v = useFieldErrors();
  const { pending, error, run } = useAction();
  const ids = { number: `assign-${receiptId}`, reason: `reject-${receiptId}` };

  function assign(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate({
      [ids.number]: [number, rules.required("Requisition number is required."), (x) => (REQUISITION_NUMBER.test(x.trim()) ? null : "Enter a requisition number like TKT-REQ-2026-0001.")],
    });
    if (!v.check(errors, formRef.current)) return;
    run(() => assignUnmatchedReceipt(receiptId, number), { successMessage: "Receipt assigned successfully.", onSuccess: () => setNumber("") });
  }

  function reject() {
    if (!v.check(validate({ [ids.reason]: [reason, rules.required("A reason is required."), rules.minLength(3, "Give a reason of at least 3 characters.")] }), formRef.current)) return;
    run(() => rejectUnmatchedReceipt(receiptId, reason), { successMessage: "Receipt rejected successfully.", onSuccess: () => { setRejecting(false); setReason(""); } });
  }

  return (
    <form ref={formRef} className="mt-3 space-y-2" onSubmit={assign} noValidate>
      <div className="flex flex-wrap items-start gap-2">
        <Field label="Requisition number" htmlFor={ids.number} required error={v.errors[ids.number]} className="min-w-0 flex-1 sm:max-w-xs">
          <Input value={number} onChange={(e) => { setNumber(e.target.value); v.clear(ids.number); }} placeholder="TKT-REQ-2026-0001" className="h-11 uppercase" autoCapitalize="characters" />
        </Field>
        <div className="flex gap-2 sm:pt-7">
          <LoadingButton type="submit" size="sm" className="h-11" pending={pending && !rejecting} pendingLabel="Assigning…" disabled={pending}>Assign</LoadingButton>
          {!rejecting ? <Button type="button" size="sm" variant="ghost" className="h-11" disabled={pending} onClick={() => setRejecting(true)}>Reject</Button> : null}
        </div>
      </div>
      {rejecting ? (
        <div className="space-y-2 rounded-xl bg-neutral-gray p-3">
          <Field label="Why reject this receipt?" htmlFor={ids.reason} required error={v.errors[ids.reason]} hint="For example: spam or duplicate.">
            <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); v.clear(ids.reason); }} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-10" disabled={pending} onClick={() => { setRejecting(false); setReason(""); v.clear(ids.reason); }}>Cancel</Button>
            <LoadingButton type="button" size="sm" variant="danger" className="h-10" pending={pending} pendingLabel="Rejecting…" onClick={reject}>Reject receipt</LoadingButton>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm font-medium">{error}</p> : null}
    </form>
  );
}
