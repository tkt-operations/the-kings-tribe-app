"use client";

import { useMemo, useState } from "react";
import { Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
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
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          run(() => recordVendorOrder(requisitionId, { ...order, purchase_order_id: order.purchase_order_id || null, items: lines.filter((l) => l.include).map((l) => ({ requisition_item_id: l.id, quantity: l.quantity, unit_price: l.unit_price })) }), () => setOpen(false));
        }}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor" htmlFor="vo_vendor" required><Input id="vo_vendor" value={order.vendor_name} onChange={(e) => setOrder({ ...order, vendor_name: e.target.value })} required /></Field>
            <Field label="Vendor order / reference #" htmlFor="vo_ref"><Input id="vo_ref" value={order.vendor_reference} onChange={(e) => setOrder({ ...order, vendor_reference: e.target.value })} /></Field>
            <Field label="Order date" htmlFor="vo_date" required><Input id="vo_date" type="date" value={order.order_date} onChange={(e) => setOrder({ ...order, order_date: e.target.value })} required /></Field>
            <Field label="Expected delivery" htmlFor="vo_eta"><Input id="vo_eta" type="date" min={order.order_date} value={order.expected_delivery_date} onChange={(e) => setOrder({ ...order, expected_delivery_date: e.target.value })} /></Field>
            {purchaseOrders.length ? (
              <Field label="Purchase Order" htmlFor="vo_po">
                <Select id="vo_po" value={order.purchase_order_id} onChange={(e) => setOrder({ ...order, purchase_order_id: e.target.value })}>
                  <option value="">None</option>
                  {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Items ordered (quantity and actual or expected unit price)</p>
            {eligible.map((e, i) => (
              <div key={e.item.id} className="grid items-center gap-2 rounded-2xl border border-navy/10 p-3 sm:grid-cols-[auto_1fr_7rem_9rem]">
                <label className="flex items-center gap-3 sm:contents">
                  <Checkbox checked={lines[i].include} onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, include: ev.target.checked } : l)))} aria-label={`Include ${e.item.description}`} />
                  <span className="text-sm"><span className="font-medium">{e.item.line}. {e.item.description}</span><span className="block text-navy/55">{showQty(e.remaining)} not yet ordered</span></span>
                </label>
                <Input aria-label="Quantity ordered" inputMode="decimal" className="tabular" value={lines[i].quantity} disabled={!lines[i].include} onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, quantity: ev.target.value } : l)))} />
                <Input aria-label="Unit price" inputMode="decimal" className="tabular" value={lines[i].unit_price} disabled={!lines[i].include} onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, unit_price: ev.target.value } : l)))} />
              </div>
            ))}
          </div>
          <Field label="Notes" htmlFor="vo_notes"><Textarea id="vo_notes" rows={2} value={order.notes} onChange={(e) => setOrder({ ...order, notes: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">Order total <span className="tabular ml-2 font-serif text-2xl">{formatCents(total, currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !lines.some((l) => l.include)}>{pending ? <Spinner /> : null}Record order</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
