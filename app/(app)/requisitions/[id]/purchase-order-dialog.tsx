"use client";

import { useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { formatCents, lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { issuePurchaseOrder } from "./actions";
import { hundredths, showQty } from "./qty";
import type { ItemModel } from "./types";

export function PurchaseOrderDialog({ requisitionId, items, currency }: { requisitionId: string; items: ItemModel[]; currency: string }) {
  const eligible = useMemo(
    () =>
      items
        .filter((i) => i.reviewStatus === "approved")
        .map((i) => ({ item: i, remaining: hundredths(i.approvedQuantity) - hundredths(i.poQuantity) - hundredths(i.cancelledQuantity) }))
        .filter((x) => x.remaining > 0n),
    [items],
  );
  const vendors = [...new Set(eligible.map((e) => e.item.vendorName).filter(Boolean))];
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(() => eligible.map((e) => ({ id: e.item.id, include: true, quantity: showQty(e.remaining), unit_price: e.item.approvedUnitPrice ?? "" })));
  const [vendor, setVendor] = useState({ name: vendors.length === 1 ? (vendors[0] as string) : "", contact: "", email: "", phone: "", address: "", url: "" });
  const [notes, setNotes] = useState("");
  const { pending, error, message, run } = useAction();

  const total = sumCents(lines.filter((l) => l.include).map((l) => {
    const q = parseQuantity(l.quantity);
    const p = parseMoney(l.unit_price);
    return q !== null && p !== null ? lineTotal(q, p) : 0n;
  }));

  if (eligible.length === 0) {
    return message ? <p className="self-center text-sm font-medium">{message}</p> : null;
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><FilePlus2 className="size-4" aria-hidden /> Issue PO</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Issue Purchase Order" description="Only approved quantities not already on a Purchase Order can be included. A branded PDF is generated and emailed to the requester." wide>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => issuePurchaseOrder(requisitionId, { vendor, notes, items: lines.filter((l) => l.include).map((l) => ({ requisition_item_id: l.id, quantity: l.quantity, unit_price: l.unit_price })) }), () => setOpen(false));
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="space-y-2">
            {eligible.map((e, i) => (
              <div key={e.item.id} className="grid items-center gap-2 rounded-2xl border border-navy/10 p-3 sm:grid-cols-[auto_1fr_7rem_9rem]">
                <label className="flex items-center gap-3 sm:contents">
                  <Checkbox checked={lines[i].include} onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, include: ev.target.checked } : l)))} aria-label={`Include ${e.item.description}`} />
                  <span className="text-sm">
                    <span className="font-medium">{e.item.line}. {e.item.description}</span>
                    <span className="block text-navy/55">{showQty(e.remaining)} available</span>
                  </span>
                </label>
                <Input aria-label="Quantity" inputMode="decimal" className="tabular" value={lines[i].quantity} disabled={!lines[i].include}
                  onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, quantity: ev.target.value } : l)))} />
                <Input aria-label="Unit price" inputMode="decimal" className="tabular" value={lines[i].unit_price} disabled={!lines[i].include}
                  onChange={(ev) => setLines((p) => p.map((l, j) => (j === i ? { ...l, unit_price: ev.target.value } : l)))} />
              </div>
            ))}
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Vendor (optional — leave blank if items come from several vendors)</legend>
            <Field label="Vendor name" htmlFor="po_vendor_name"><Input id="po_vendor_name" value={vendor.name} onChange={(e) => setVendor({ ...vendor, name: e.target.value })} /></Field>
            <Field label="Contact" htmlFor="po_vendor_contact"><Input id="po_vendor_contact" value={vendor.contact} onChange={(e) => setVendor({ ...vendor, contact: e.target.value })} /></Field>
            <Field label="Email" htmlFor="po_vendor_email"><Input id="po_vendor_email" type="email" inputMode="email" value={vendor.email} onChange={(e) => setVendor({ ...vendor, email: e.target.value })} /></Field>
            <Field label="Phone" htmlFor="po_vendor_phone"><Input id="po_vendor_phone" type="tel" inputMode="tel" value={vendor.phone} onChange={(e) => setVendor({ ...vendor, phone: e.target.value })} /></Field>
            <Field label="Address" htmlFor="po_vendor_address"><Input id="po_vendor_address" value={vendor.address} onChange={(e) => setVendor({ ...vendor, address: e.target.value })} /></Field>
            <Field label="Website" htmlFor="po_vendor_url"><Input id="po_vendor_url" type="url" inputMode="url" placeholder="https://" value={vendor.url} onChange={(e) => setVendor({ ...vendor, url: e.target.value })} /></Field>
          </fieldset>
          <Field label="Notes on the PO" htmlFor="po_notes"><Textarea id="po_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">PO total <span className="tabular ml-2 font-serif text-2xl">{formatCents(total, currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="gold" disabled={pending || !lines.some((l) => l.include)}>{pending ? <Spinner /> : null}{pending ? "Issuing…" : "Issue & email PO"}</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
