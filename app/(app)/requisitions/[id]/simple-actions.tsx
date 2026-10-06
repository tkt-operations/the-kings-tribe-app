"use client";

import { useState } from "react";
import { Ban, FileDown, Play, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import {
  addComment, assignReviewer, cancelRemaining, cancelVendorOrder, closeRequisition, regeneratePurchaseOrderPdf,
  rejectReceipt, startReview, voidPurchaseOrder,
} from "./actions";

export function StartReviewButton({ requisitionId }: { requisitionId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <Button variant="secondary" disabled={pending} onClick={() => run(() => startReview(requisitionId))}>
        {pending ? <Spinner /> : <Play className="size-4" aria-hidden />} Start review
      </Button>
      {error ? <p className="mt-1 text-sm">{error}</p> : null}
    </div>
  );
}

/** Generic "give a reason" confirmation dialog. */
function ReasonDialog({
  label, title, description, icon, variant = "secondary", requireReason = true, confirmLabel, onConfirm, extra,
}: {
  label: string; title: string; description: string; icon?: React.ReactNode; variant?: "secondary" | "danger" | "primary" | "ghost";
  requireReason?: boolean; confirmLabel: string; onConfirm: (reason: string, extraValue: string) => ReturnType<typeof voidPurchaseOrder>;
  extra?: { label: string; defaultValue: string; inputMode?: "decimal" };
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extraValue, setExtraValue] = useState(extra?.defaultValue ?? "");
  const { pending, error, run } = useAction();
  return (
    <>
      <Button variant={variant} size="sm" className="h-10" onClick={() => setOpen(true)}>{icon}{label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => onConfirm(reason, extraValue), () => setOpen(false)); }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {extra ? (
            <Field label={extra.label} htmlFor="extra">
              <Input id="extra" value={extraValue} onChange={(e) => setExtraValue(e.target.value)} inputMode={extra.inputMode} />
            </Field>
          ) : null}
          <Field label={requireReason ? "Reason (required)" : "Comment (optional)"} htmlFor="reason">
            <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required={requireReason} minLength={requireReason ? 3 : undefined} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} disabled={pending || (requireReason && reason.trim().length < 3)}>
              {pending ? <Spinner /> : null}{confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function VoidPoButton({ requisitionId, purchaseOrderId }: { requisitionId: string; purchaseOrderId: string }) {
  return <ReasonDialog label="Void PO" title="Void Purchase Order" description="The PO stays on record but no longer authorizes purchases." icon={<Ban className="size-4" aria-hidden />}
    variant="danger" confirmLabel="Void Purchase Order" onConfirm={(r) => voidPurchaseOrder(requisitionId, purchaseOrderId, r)} />;
}

export function CancelOrderButton({ requisitionId, orderId }: { requisitionId: string; orderId: string }) {
  return <ReasonDialog label="Cancel order" title="Cancel vendor order" description="Quantities on this order return to “not yet ordered”." icon={<XCircle className="size-4" aria-hidden />}
    variant="danger" confirmLabel="Cancel order" onConfirm={(r) => cancelVendorOrder(requisitionId, orderId, r)} />;
}

export function RejectReceiptButton({ requisitionId, receiptId }: { requisitionId: string; receiptId: string }) {
  return <ReasonDialog label="Reject receipt" title="Reject receipt" description="Use this for duplicates, unreadable images or receipts that don’t belong to this request."
    variant="ghost" confirmLabel="Reject receipt" onConfirm={(r) => rejectReceipt(requisitionId, receiptId, r)} />;
}

export function CancelRemainingButton({ requisitionId, itemId, max }: { requisitionId: string; itemId: string; max: string }) {
  return <ReasonDialog label="Won’t buy rest" title="Cancel remaining quantity" description="Marks approved quantity that will not be purchased, so the request can complete."
    variant="ghost" confirmLabel="Cancel remaining" extra={{ label: `Quantity not to purchase (max ${max})`, defaultValue: max, inputMode: "decimal" }}
    onConfirm={(r, qty) => cancelRemaining(requisitionId, itemId, qty, r)} />;
}

export function CloseRequisitionButton({ requisitionId, requireComment }: { requisitionId: string; requireComment: boolean }) {
  return <ReasonDialog label="Close requisition" title="Close requisition" description={requireComment ? "Purchasing is not complete. Explain why this request is being closed." : "Closing marks this request as finished."}
    requireReason={requireComment} confirmLabel="Close requisition" onConfirm={(r) => closeRequisition(requisitionId, r)} />;
}

export function RegeneratePdfButton({ purchaseOrderId, hasPdf }: { purchaseOrderId: string; hasPdf: boolean }) {
  const { pending, error, message, run } = useAction();
  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" size="sm" className="h-10" disabled={pending} onClick={() => run(() => regeneratePurchaseOrderPdf(purchaseOrderId))}>
        {pending ? <Spinner /> : <FileDown className="size-4" aria-hidden />} {hasPdf ? "Regenerate PDF" : "Generate PDF"}
      </Button>
      {error || message ? <span className="mt-1 text-xs">{error ?? message}</span> : null}
    </span>
  );
}

export function AssignReviewer({ requisitionId, reviewers, current }: { requisitionId: string; reviewers: { id: string; name: string }[]; current: string | null }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <Field label="Assigned reviewer" htmlFor="assigned_reviewer">
        <Select id="assigned_reviewer" defaultValue={current ?? ""} disabled={pending}
          onChange={(e) => run(() => assignReviewer(requisitionId, e.target.value || null))}>
          <option value="">Unassigned</option>
          {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      {error ? <p className="mt-1 text-sm">{error}</p> : null}
    </div>
  );
}

export function CommentForm({ requisitionId }: { requisitionId: string }) {
  const [body, setBody] = useState("");
  const { pending, error, run } = useAction();
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => addComment(requisitionId, body), () => setBody("")); }}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal comment…" aria-label="Comment" maxLength={4000} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-10" disabled={pending || !body.trim()}>{pending ? <Spinner /> : null}Add comment</Button>
      </div>
    </form>
  );
}
