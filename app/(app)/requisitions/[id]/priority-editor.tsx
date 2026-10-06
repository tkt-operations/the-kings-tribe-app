"use client";

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, RequiredNote, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { PriorityField } from "@/components/ui/priority-field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { ESSENTIAL_JUSTIFICATION_MIN, type Priority } from "@/lib/priority";
import { rules, validate } from "@/lib/validation/form";
import { updateItemPriority } from "./actions";

/**
 * Finance can correct a line's priority. The change is audit-logged (previous
 * and new priority, who, when) and never alters the review decision or money.
 */
export function PriorityEditor({ requisitionId, item }: {
  requisitionId: string;
  item: { id: string; line: number; description: string; priority: Priority; essentialJustification: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [reason, setReason] = useState(item.essentialJustification ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, run } = useAction();
  const ids = { priority: `pe_priority_${item.id}`, reason: `pe_reason_${item.id}` };

  function reset() {
    setPriority(item.priority);
    setReason(item.essentialJustification ?? "");
    fields.setErrors({});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Only Essential needs (and shows) a reason.
    const errors =
      priority === "essential"
        ? validate({
            [ids.reason]: [
              reason,
              rules.required("Explain why this item is essential."),
              rules.minLength(ESSENTIAL_JUSTIFICATION_MIN, `Explain why this item is essential (at least ${ESSENTIAL_JUSTIFICATION_MIN} characters).`),
            ],
          })
        : {};
    if (!fields.check(errors, formRef.current)) return;
    run(() => updateItemPriority(requisitionId, item.id, { priority, essential_justification: reason }), {
      errorMessage: "Unable to update item priority. Please try again.",
      onSuccess: () => setOpen(false),
      onError: (_e, fe) => fe?.essential_justification && fields.show({ [ids.reason]: fe.essential_justification }, formRef.current),
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="h-8 px-2 text-[12px]" onClick={() => { reset(); setOpen(true); }} aria-label={`Change priority for line ${item.line}, ${item.description}`}>
        <Pencil className="size-3.5" aria-hidden /> Change
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Change item priority" description={`Line ${item.line}: ${item.description}. The change is recorded in the audit history. It does not approve or reject the item.`}>
        <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <PriorityField
            id={ids.priority}
            value={priority}
            inputProps={(p) => ({ name: ids.priority, value: p, checked: priority === p, onChange: () => { setPriority(p); fields.clear(ids.reason); } })}
          />
          {priority === "essential" ? (
            <Field label="Why is this item essential?" htmlFor={ids.reason} required error={fields.errors[ids.reason]} hint="Briefly explain the operational impact if this item is not purchased.">
              <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); fields.clear(ids.reason); }} />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Save priority</LoadingButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
