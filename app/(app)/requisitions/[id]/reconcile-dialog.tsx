"use client";

import { useRef, useState } from "react";
import { Scale } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate, type Check } from "@/lib/validation/form";
import { cn } from "@/lib/cn";
import { formatCents, lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { reconcileReceipt } from "./actions";
import { hundredths, showQty } from "./qty";
import type { ItemModel } from "./types";

/**
 * Compares PO / APPROVED information with the ACTUAL purchase on this receipt,
 * line by line. Only what Finance confirms here is marked purchased.
 */
export function ReconcileDialog({ requisitionId, receipt, items, purchaseOrderItems, currency }: {
  requisitionId: string;
  receipt: { id: string; vendor_name: string | null; purchase_date: string | null; total_amount: string | null; reference: string | null; purchase_order_id: string | null };
  items: ItemModel[];
  purchaseOrderItems: { id: string; requisitionItemId: string; poNumber: string; poId: string }[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState({ vendor_name: receipt.vendor_name ?? "", purchase_date: receipt.purchase_date ?? "", total_amount: receipt.total_amount ?? "", reference: receipt.reference ?? "", notes: "" });
  const [lines, setLines] = useState(() =>
    items.map((i) => {
      const poLines = purchaseOrderItems.filter((p) => p.requisitionItemId === i.id && (!receipt.purchase_order_id || p.poId === receipt.purchase_order_id));
      return { id: i.id, quantity: "", actual_amount: "", purchase_order_item_id: poLines.length === 1 ? poLines[0].id : "" };
    }),
  );
  const { pending, error, run } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const fmt = (c: bigint) => formatCents(c, currency);
  const allocated = sumCents(lines.map((l) => parseMoney(l.actual_amount) ?? 0n));
  const receiptTotal = parseMoney(details.total_amount);

  function setLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    fields.clear("rec_lines");
    if ("quantity" in patch) fields.clear(`rec_qty_${i}`);
    if ("actual_amount" in patch) fields.clear(`rec_amount_${i}`);
  }

  function setDetail(key: keyof typeof details, id: string | null, value: string) {
    setDetails({ ...details, [key]: value });
    if (id) fields.clear(id);
  }

  function validateReconcile() {
    const spec: Record<string, [string, ...Check[]]> = {
      rec_date: [details.purchase_date, rules.date()],
      rec_total: [details.total_amount, rules.money("Enter the receipt total like 24.99.")],
      rec_lines: [lines.some((l) => l.quantity.trim()) ? "ok" : "", rules.required("Enter the quantity purchased for at least one line.")],
    };
    items.forEach((item, i) => {
      if (!lines[i].quantity.trim()) return;
      const remaining = hundredths(item.approvedQuantity) - hundredths(item.purchasedQuantity) - hundredths(item.cancelledQuantity);
      spec[`rec_qty_${i}`] = [lines[i].quantity, rules.quantity(), rules.maxQuantity(remaining, `Only ${showQty(remaining)} remaining for this line.`)];
      spec[`rec_amount_${i}`] = [lines[i].actual_amount, rules.money("Enter the actual cost like 24.99.")];
    });
    return validate(spec);
  }

  return (
    <>
      <Button size="sm" className="h-10" onClick={() => setOpen(true)}><Scale className="size-4" aria-hidden /> Reconcile</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Reconcile receipt" description="Enter what this receipt actually covers. Leave lines blank if they are not on this receipt." wide>
        <form ref={formRef} className="space-y-5" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!fields.check(validateReconcile(), formRef.current)) return;
          run(() => reconcileReceipt(requisitionId, receipt.id, {
            ...details,
            allocations: lines.filter((l) => l.quantity.trim() !== "").map((l) => ({ requisition_item_id: l.id, quantity: l.quantity, actual_amount: l.actual_amount || "0", purchase_order_item_id: l.purchase_order_item_id || null })),
          }), { errorMessage: "Unable to reconcile the receipt. Please try again.", onSuccess: () => setOpen(false) });
        }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Vendor" htmlFor="rec_vendor"><Input value={details.vendor_name} maxLength={200} onChange={(e) => setDetail("vendor_name", null, e.target.value)} /></Field>
            <Field label="Purchase date" htmlFor="rec_date" error={fields.errors.rec_date}><Input type="date" value={details.purchase_date} onChange={(e) => setDetail("purchase_date", "rec_date", e.target.value)} /></Field>
            <Field label="Receipt total" htmlFor="rec_total" error={fields.errors.rec_total}><Input inputMode="decimal" className="tabular" value={details.total_amount} onChange={(e) => setDetail("total_amount", "rec_total", e.target.value)} /></Field>
            <Field label="Receipt reference" htmlFor="rec_ref"><Input value={details.reference} maxLength={200} onChange={(e) => setDetail("reference", null, e.target.value)} /></Field>
          </div>

          <div id="rec_lines" className="space-y-3" role="group" aria-label="Lines on this receipt" data-invalid={fields.errors.rec_lines ? true : undefined} aria-describedby={fields.errors.rec_lines ? "rec_lines-error" : undefined}>
            <p className="text-sm text-navy/65">Enter at least one line.</p>
            {items.map((item, i) => {
              const approvedQ = hundredths(item.approvedQuantity);
              const purchased = hundredths(item.purchasedQuantity);
              const remaining = approvedQ - purchased - hundredths(item.cancelledQuantity);
              const unit = parseMoney(item.approvedUnitPrice ?? "0") ?? 0n;
              const q = parseQuantity(lines[i].quantity);
              const actual = parseMoney(lines[i].actual_amount);
              const expected = q !== null ? lineTotal(q, unit) : null;
              const variance = expected !== null && actual !== null ? actual - expected : null;
              const over = q !== null && q > remaining;
              const poLines = purchaseOrderItems.filter((p) => p.requisitionItemId === item.id);
              return (
                <div key={item.id} className={cn("rounded-2xl border p-3", over ? "border-energy-orange" : "border-navy/10")}>
                  <p className="font-medium">{item.line}. {item.description}</p>
                  <dl className="tabular mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[13px] sm:grid-cols-6">
                    <div><dt className="text-navy/55">Ordered</dt><dd>{showQty(hundredths(item.orderedQuantity))}</dd></div>
                    <div><dt className="text-navy/55">Approved</dt><dd>{showQty(approvedQ)} · {fmt(parseMoney(item.approvedTotal) ?? 0n)}</dd></div>
                    <div><dt className="text-navy/55">Purchased</dt><dd>{showQty(purchased)}</dd></div>
                    <div><dt className="text-navy/55">Actual so far</dt><dd>{fmt(parseMoney(item.actualTotal) ?? 0n)}</dd></div>
                    <div><dt className="text-navy/55">Remaining</dt><dd className="font-bold">{showQty(remaining)}</dd></div>
                    <div><dt className="text-navy/55">Variance</dt><dd className={cn(variance !== null && variance !== 0n && "font-bold")}>{variance === null ? "—" : `${variance > 0n ? "+" : ""}${fmt(variance)}`}</dd></div>
                  </dl>
                  <div className="mt-2 grid items-start gap-2 sm:grid-cols-[8rem_9rem_1fr]">
                    <Field label={<>Qty bought<span className="sr-only"> on this receipt for line {item.line}</span></>} htmlFor={`rec_qty_${i}`}
                      error={fields.errors[`rec_qty_${i}`] ?? (over ? "More than the remaining approved quantity." : undefined)}>
                      <Input inputMode="decimal" className="tabular" value={lines[i].quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value, actual_amount: lines[i].actual_amount || (parseQuantity(e.target.value) !== null ? formatPlain(lineTotal(parseQuantity(e.target.value)!, unit)) : "") })}
                        disabled={remaining <= 0n} />
                    </Field>
                    <Field label={<>Actual cost<span className="sr-only"> for line {item.line}</span></>} htmlFor={`rec_amount_${i}`} error={fields.errors[`rec_amount_${i}`]}>
                      <Input inputMode="decimal" className="tabular" value={lines[i].actual_amount} onChange={(e) => setLine(i, { actual_amount: e.target.value })} disabled={remaining <= 0n} />
                    </Field>
                    {poLines.length ? (
                      <Field label={<>PO line<span className="sr-only"> for line {item.line}</span></>} htmlFor={`rec_po_${i}`}>
                        <Select value={lines[i].purchase_order_item_id} onChange={(e) => setLine(i, { purchase_order_item_id: e.target.value })} disabled={remaining <= 0n}>
                          <option value="">No PO line</option>
                          {poLines.map((p) => <option key={p.id} value={p.id}>{p.poNumber}</option>)}
                        </Select>
                      </Field>
                    ) : <span />}
                  </div>
                </div>
              );
            })}
            <FieldError id="rec_lines-error" message={fields.errors.rec_lines} />
          </div>

          <Field label="Reconciliation notes" htmlFor="rec_notes"><Textarea rows={2} value={details.notes} maxLength={2000} onChange={(e) => setDetail("notes", null, e.target.value)} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">
              Allocated <span className="tabular font-serif text-2xl">{fmt(allocated)}</span>
              {receiptTotal !== null && receiptTotal !== allocated ? <span className="ml-2 text-navy/60">of {fmt(receiptTotal)} on the receipt (tax/shipping may account for the difference)</span> : null}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" variant="gold" pending={pending} pendingLabel="Saving…">Confirm reconciliation</LoadingButton>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function formatPlain(cents: bigint) {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
