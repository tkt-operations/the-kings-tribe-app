"use client";

import { useRef, useState } from "react";
import { Ban, FileDown, Play, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate, type Check } from "@/lib/validation/form";
import { parseQuantity } from "@/lib/money";
import {
  addComment, assignReviewer, cancelRemaining, cancelVendorOrder, closeRequisition, regeneratePurchaseOrderPdf,
  rejectReceipt, startReview, voidPurchaseOrder,
} from "./actions";

export function StartReviewButton({ requisitionId }: { requisitionId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <LoadingButton variant="secondary" pending={pending} pendingLabel="Starting…" icon={<Play className="size-4" aria-hidden />}
        onClick={() => run(() => startReview(requisitionId), { successMessage: "Review started successfully.", errorMessage: "Unable to start the review. Please try again." })}>
        Start review
      </LoadingButton>
      {error ? <p role="alert" className="mt-1 text-sm font-medium">{error}</p> : null}
    </div>
  );
}

/** Generic "give a reason" confirmation dialog. */
function ReasonDialog({
  label, title, description, icon, variant = "secondary", requireReason = true, confirmLabel, errorMessage, onConfirm, extra,
}: {
  label: string; title: string; description: string; icon?: React.ReactNode; variant?: "secondary" | "danger" | "primary" | "ghost";
  requireReason?: boolean; confirmLabel: string; errorMessage: string; onConfirm: (reason: string, extraValue: string) => ReturnType<typeof voidPurchaseOrder>;
  extra?: { label: string; defaultValue: string; inputMode?: "decimal"; checks: Check[] };
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extraValue, setExtraValue] = useState(extra?.defaultValue ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, run } = useAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const spec: Record<string, [string, ...Check[]]> = {
      reason: [reason, ...(requireReason ? [rules.required("A reason is required."), rules.minLength(3, "Give a reason of at least 3 characters.")] : [])],
    };
    if (extra) spec.extra = [extraValue, ...extra.checks];
    if (!fields.check(validate(spec), formRef.current)) return;
    run(() => onConfirm(reason, extraValue), { errorMessage, onSuccess: () => setOpen(false) });
  }

  return (
    <>
      <Button variant={variant} size="sm" className="h-10" onClick={() => { fields.setErrors({}); setOpen(true); }}>{icon}{label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {requireReason || extra ? <RequiredNote /> : null}
          {extra ? (
            <Field label={extra.label} htmlFor="extra" required error={fields.errors.extra}>
              <Input value={extraValue} onChange={(e) => { setExtraValue(e.target.value); fields.clear("extra"); }} inputMode={extra.inputMode} />
            </Field>
          ) : null}
          <Field label={requireReason ? "Reason" : "Comment (optional)"} htmlFor="reason" required={requireReason} error={fields.errors.reason}>
            <Textarea rows={3} value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); fields.clear("reason"); }} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <LoadingButton type="submit" variant={variant === "danger" ? "danger" : "primary"} pending={pending} pendingLabel="Saving…">
              {confirmLabel}
            </LoadingButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function VoidPoButton({ requisitionId, purchaseOrderId }: { requisitionId: string; purchaseOrderId: string }) {
  return <ReasonDialog label="Void PO" title="Void Purchase Order" description="The PO stays on record but no longer authorizes purchases." icon={<Ban className="size-4" aria-hidden />}
    variant="danger" confirmLabel="Void Purchase Order" errorMessage="Unable to void the purchase order. Please try again." onConfirm={(r) => voidPurchaseOrder(requisitionId, purchaseOrderId, r)} />;
}

export function CancelOrderButton({ requisitionId, orderId }: { requisitionId: string; orderId: string }) {
  return <ReasonDialog label="Cancel order" title="Cancel vendor order" description="Quantities on this order return to “not yet ordered”." icon={<XCircle className="size-4" aria-hidden />}
    variant="danger" confirmLabel="Cancel order" errorMessage="Unable to cancel the vendor order. Please try again." onConfirm={(r) => cancelVendorOrder(requisitionId, orderId, r)} />;
}

export function RejectReceiptButton({ requisitionId, receiptId }: { requisitionId: string; receiptId: string }) {
  return <ReasonDialog label="Reject receipt" title="Reject receipt" description="Use this for duplicates, unreadable images or receipts that don’t belong to this request."
    variant="ghost" confirmLabel="Reject receipt" errorMessage="Unable to reject the receipt. Please try again." onConfirm={(r) => rejectReceipt(requisitionId, receiptId, r)} />;
}

export function CancelRemainingButton({ requisitionId, itemId, max }: { requisitionId: string; itemId: string; max: string }) {
  return <ReasonDialog label="Won’t buy rest" title="Cancel remaining quantity" description="Marks approved quantity that will not be purchased, so the request can complete."
    variant="ghost" confirmLabel="Cancel remaining" errorMessage="Unable to cancel the remaining quantity. Please try again."
    extra={{ label: `Quantity not to purchase (max ${max})`, defaultValue: max, inputMode: "decimal", checks: [rules.required("Enter a quantity."), rules.quantity(), rules.maxQuantity(parseQuantity(max) ?? 0n, `Enter ${max} or less.`)] }}
    onConfirm={(r, qty) => cancelRemaining(requisitionId, itemId, qty, r)} />;
}

export function CloseRequisitionButton({ requisitionId, requireComment }: { requisitionId: string; requireComment: boolean }) {
  return <ReasonDialog label="Close requisition" title="Close requisition" description={requireComment ? "Purchasing is not complete. Explain why this request is being closed." : "Closing marks this request as finished."}
    requireReason={requireComment} confirmLabel="Close requisition" errorMessage="Unable to close the requisition. Please try again." onConfirm={(r) => closeRequisition(requisitionId, r)} />;
}

export function RegeneratePdfButton({ purchaseOrderId, hasPdf }: { purchaseOrderId: string; hasPdf: boolean }) {
  const { pending, error, message, run } = useAction();
  return (
    <span className="inline-flex flex-col">
      <LoadingButton variant="secondary" size="sm" className="h-10" pending={pending} pendingLabel="Generating…" icon={<FileDown className="size-4" aria-hidden />}
        onClick={() => run(() => regeneratePurchaseOrderPdf(purchaseOrderId), { successMessage: "Purchase order PDF generated successfully.", errorMessage: "Unable to generate the PDF. Please try again." })}>
        {hasPdf ? "Regenerate PDF" : "Generate PDF"}
      </LoadingButton>
      {error ? <span role="alert" className="mt-1 text-xs font-medium">{error}</span> : message ? <span className="mt-1 text-xs">{message}</span> : null}
    </span>
  );
}

export function AssignReviewer({ requisitionId, reviewers, current }: { requisitionId: string; reviewers: { id: string; name: string }[]; current: string | null }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <Field label="Assigned reviewer" htmlFor="assigned_reviewer">
        <Select id="assigned_reviewer" defaultValue={current ?? ""} disabled={pending}
          onChange={(e) => {
            const reviewer = e.target.value || null;
            run(() => assignReviewer(requisitionId, reviewer), { successMessage: reviewer ? "Reviewer assigned successfully." : "Reviewer removed successfully." });
          }}>
          <option value="">Unassigned</option>
          {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      {error ? <p role="alert" className="mt-1 text-sm font-medium">{error}</p> : null}
    </div>
  );
}

export function CommentForm({ requisitionId }: { requisitionId: string }) {
  const [body, setBody] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const { pending, error, run } = useAction();
  return (
    <form ref={formRef} className="space-y-2" noValidate onSubmit={(e) => {
      e.preventDefault();
      if (!fields.check(validate({ comment_body: [body, rules.required("Write a comment before adding it.")] }), formRef.current, { announce: false })) return;
      run(() => addComment(requisitionId, body), { successMessage: "Comment added successfully.", errorMessage: "Unable to add the comment. Please try again.", onSuccess: () => setBody("") });
    }}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="Internal comment" htmlFor="comment_body" required error={fields.errors.comment_body}>
        <Textarea rows={3} value={body} onChange={(e) => { setBody(e.target.value); fields.clear("comment_body"); }} placeholder="Add an internal comment…" maxLength={4000} />
      </Field>
      <div className="flex justify-end">
        <LoadingButton type="submit" size="sm" className="h-10" pending={pending} pendingLabel="Adding…">Add comment</LoadingButton>
      </div>
    </form>
  );
}
