"use client";

import { useMemo, useRef, useState } from "react";
import { Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FieldError, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate, type Check } from "@/lib/validation/form";
import { formatCents, lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { recordVendorOrder } from "./actions";
import { hundredths, showQty } from "./qty";
import type { ItemModel } from "./types";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function VendorOrderDialog({ requisitionId, items, currency, purchaseOrders }: {
  requisitionId: string; items: ItemModel[]; currency: string; purchaseOrders: { id: string; po_number: string; vendor_name: string | null }[];
}) {
  const eligible = useMemo(
    () =>
      items
        .filter((i) => i.reviewStatus === "approved")
        .map((i) => ({ item: i, remaining: hundredths(i.approvedQuantity) - hundredths(i.orderedQuantity) - hundredths(i.cancelledQuantity) }))
        .filter((x) => x.remaining > 0n),
    [items],
  );
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(() => eligible.map((e) => ({ id: e.item.id, include: true, quantity: showQty(e.remaining), unit_price: e.item.approvedUnitPrice ?? "" })));
  const [order, setOrder] = useState({ vendor_name: purchaseOrders[0]?.vendor_name ?? eligible[0]?.item.vendorName ?? "", vendor_reference: "", order_date: localToday(), expected_delivery_date: "", notes: "", purchase_order_id: purchaseOrders.length === 1 ? purchaseOrders[0].id : "" });
  const { pending, error, run } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    fields.clear("vo_lines");
    if ("quantity" in patch) fields.clear(`vo_qty_${i}`);
    if ("unit_price" in patch) fields.clear(`vo_price_${i}`);
  };
  const setOrderField = (key: keyof typeof order, id: string, value: string) => {
    setOrder({ ...order, [key]: value });
    fields.clear(id);
  };

  function validateOrder() {
    const spec: Record<string, [string, ...Check[]]> = {
      vo_vendor: [order.vendor_name, rules.required("Vendor is required.")],
      vo_date: [order.order_date, rules.required("Order date is required."), rules.date()],
      vo_eta: [order.expected_delivery_date, rules.date(), rules.notBefore(order.order_date, "Expected delivery can't be before the order date.")],
      vo_lines: [lines.some((l) => l.include) ? "ok" : "", rules.required("Select at least one item that was ordered.")],
    };
    eligible.forEach((e, i) => {
      if (!lines[i].include) return;
      spec[`vo_qty_${i}`] = [lines[i].quantity, rules.required("Enter the quantity ordered."), rules.quantity(), rules.maxQuantity(e.remaining, `Only ${showQty(e.remaining)} not yet ordered.`)];
      spec[`vo_price_${i}`] = [lines[i].unit_price, rules.money()];
    });
    return validate(spec);
  }
  const total = sumCents(lines.filter((l) => l.include).map((l) => {
    const q = parseQuantity(l.quantity);
    const p = parseMoney(l.unit_price);
    return q !== null && p !== null ? lineTotal(q, p) : 0n;
  }));
  if (eligible.length === 0) return null;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Truck className="size-4" aria-hidden /> Record order</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record vendor order" description="Record what was actually ordered. You can order part of a line now and the rest later, from one or more vendors." wide>
        <form ref={formRef} className="space-y-5" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!fields.check(validateOrder(), formRef.current)) return;
          run(() => recordVendorOrder(requisitionId, { ...order, purchase_order_id: order.purchase_order_id || null, items: lines.filter((l) => l.include).map((l) => ({ requisition_item_id: l.id, quantity: l.quantity, unit_price: l.unit_price })) }), {
            errorMessage: "Unable to record the vendor order. Please try again.",
            onSuccess: () => setOpen(false),
          });
        }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor" htmlFor="vo_vendor" required error={fields.errors.vo_vendor}><Input value={order.vendor_name} maxLength={200} onChange={(e) => setOrderField("vendor_name", "vo_vendor", e.target.value)} /></Field>
            <Field label="Vendor order / reference #" htmlFor="vo_ref"><Input value={order.vendor_reference} maxLength={120} onChange={(e) => setOrder({ ...order, vendor_reference: e.target.value })} /></Field>
            <Field label="Order date" htmlFor="vo_date" required error={fields.errors.vo_date}><Input type="date" value={order.order_date} onChange={(e) => setOrderField("order_date", "vo_date", e.target.value)} /></Field>
            <Field label="Expected delivery" htmlFor="vo_eta" error={fields.errors.vo_eta}><Input type="date" min={order.order_date} value={order.expected_delivery_date} onChange={(e) => setOrderField("expected_delivery_date", "vo_eta", e.target.value)} /></Field>
            {purchaseOrders.length ? (
              <Field label="Purchase Order" htmlFor="vo_po">
                <Select id="vo_po" value={order.purchase_order_id} onChange={(e) => setOrder({ ...order, purchase_order_id: e.target.value })}>
                  <option value="">None</option>
                  {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
          <div id="vo_lines" className="space-y-2" role="group" aria-labelledby="vo_lines-label" data-invalid={fields.errors.vo_lines ? true : undefined} aria-describedby={fields.errors.vo_lines ? "vo_lines-error" : undefined}>
            <p id="vo_lines-label" className="text-sm font-medium">Items ordered (quantity and actual or expected unit price)</p>
            {eligible.map((e, i) => (
              <div key={e.item.id} className="grid items-start gap-2 rounded-2xl border border-navy/10 p-3 sm:grid-cols-[auto_1fr_7rem_9rem]">
                <label className="flex items-center gap-3 sm:contents">
                  <Checkbox className="sm:mt-8" checked={lines[i].include} onChange={(ev) => setLine(i, { include: ev.target.checked })} aria-label={`Include ${e.item.description}`} />
                  <span className="text-sm sm:pt-7"><span className="font-medium">{e.item.line}. {e.item.description}</span><span className="block text-navy/55">{showQty(e.remaining)} not yet ordered</span></span>
                </label>
                <Field label={<>Qty ordered<span className="sr-only"> for line {e.item.line}</span></>} htmlFor={`vo_qty_${i}`} required={lines[i].include} error={fields.errors[`vo_qty_${i}`]}>
                  <Input inputMode="decimal" className="tabular" value={lines[i].quantity} disabled={!lines[i].include} onChange={(ev) => setLine(i, { quantity: ev.target.value })} />
                </Field>
                <Field label={<>Unit price<span className="sr-only"> for line {e.item.line}</span></>} htmlFor={`vo_price_${i}`} error={fields.errors[`vo_price_${i}`]}>
                  <Input inputMode="decimal" className="tabular" value={lines[i].unit_price} disabled={!lines[i].include} onChange={(ev) => setLine(i, { unit_price: ev.target.value })} />
                </Field>
              </div>
            ))}
            <FieldError id="vo_lines-error" message={fields.errors.vo_lines} />
          </div>
          <Field label="Notes" htmlFor="vo_notes"><Textarea id="vo_notes" rows={2} value={order.notes} onChange={(e) => setOrder({ ...order, notes: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">Order total <span className="tabular ml-2 font-serif text-2xl">{formatCents(total, currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" pending={pending} pendingLabel="Saving…">Record order</LoadingButton>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
