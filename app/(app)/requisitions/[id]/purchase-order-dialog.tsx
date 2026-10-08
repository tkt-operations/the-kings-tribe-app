"use client";

import { useMemo, useRef, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { Checkbox, Field, FieldError, Input, RequiredNote, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { rules, validate, type Check } from "@/lib/validation/form";
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
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    fields.clear("po_lines");
    if ("quantity" in patch) fields.clear(`po_qty_${i}`);
    if ("unit_price" in patch) fields.clear(`po_price_${i}`);
  };
  const setVendorField = (key: keyof typeof vendor, value: string) => {
    setVendor({ ...vendor, [key]: value });
    fields.clear(`po_vendor_${key}`);
  };

  function validatePo() {
    const spec: Record<string, [string, ...Check[]]> = {
      po_lines: [lines.some((l) => l.include) ? "ok" : "", rules.required("Choose at least one line to include on the purchase order.")],
      po_vendor_email: [vendor.email, rules.email("Enter a valid vendor email address.")],
      po_vendor_url: [vendor.url, rules.url("Vendor website must start with https://")],
    };
    eligible.forEach((e, i) => {
      if (!lines[i].include) return;
      spec[`po_qty_${i}`] = [lines[i].quantity, rules.required("Enter a quantity."), rules.quantity(), rules.maxQuantity(e.remaining, `Only ${showQty(e.remaining)} available for this line.`)];
      spec[`po_price_${i}`] = [lines[i].unit_price, rules.money()];
    });
    return validate(spec);
  }

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
      <Dialog open={open} onClose={() => setOpen(false)} title="Issue Purchase Order" description="Only approved quantities not already on a Purchase Order can be included. A branded PDF is generated and, when email is set up, emailed to the requester." wide>
        <form
          ref={formRef}
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!fields.check(validatePo(), formRef.current)) return;
            run(() => issuePurchaseOrder(requisitionId, { vendor, notes, items: lines.filter((l) => l.include).map((l) => ({ requisition_item_id: l.id, quantity: l.quantity, unit_price: l.unit_price })) }), {
              errorMessage: "Unable to create purchase order. Please try again.",
              onSuccess: () => setOpen(false),
            });
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <RequiredNote />
          <div id="po_lines" className="space-y-2" role="group" aria-label="Lines to include" data-invalid={fields.errors.po_lines ? true : undefined} aria-describedby={fields.errors.po_lines ? "po_lines-error" : undefined}>
            {eligible.map((e, i) => (
              <div key={e.item.id} className="grid items-start gap-2 rounded-2xl border border-navy/10 p-3 sm:grid-cols-[auto_1fr_7rem_9rem]">
                <label className="flex items-center gap-3 sm:contents">
                  <Checkbox className="sm:mt-8" checked={lines[i].include} onChange={(ev) => setLine(i, { include: ev.target.checked })} aria-label={`Include ${e.item.description}`} />
                  <span className="text-sm sm:pt-7">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium"><PriorityBadge priority={e.item.priority} size="sm" />{e.item.line}. {e.item.description}</span>
                    <span className="block text-navy/55">{showQty(e.remaining)} available</span>
                  </span>
                </label>
                <Field label={<>Quantity<span className="sr-only"> for line {e.item.line}</span></>} htmlFor={`po_qty_${i}`} required={lines[i].include} error={fields.errors[`po_qty_${i}`]}>
                  <Input inputMode="decimal" className="tabular" value={lines[i].quantity} disabled={!lines[i].include} onChange={(ev) => setLine(i, { quantity: ev.target.value })} />
                </Field>
                <Field label={<>Unit price<span className="sr-only"> for line {e.item.line}</span></>} htmlFor={`po_price_${i}`} error={fields.errors[`po_price_${i}`]}>
                  <Input inputMode="decimal" className="tabular" value={lines[i].unit_price} disabled={!lines[i].include} onChange={(ev) => setLine(i, { unit_price: ev.target.value })} />
                </Field>
              </div>
            ))}
            <FieldError id="po_lines-error" message={fields.errors.po_lines} />
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Vendor (optional — leave blank if items come from several vendors)</legend>
            <Field label="Vendor name" htmlFor="po_vendor_name" error={fields.errors.po_vendor_name}><Input value={vendor.name} onChange={(e) => setVendorField("name", e.target.value)} /></Field>
            <Field label="Contact" htmlFor="po_vendor_contact" error={fields.errors.po_vendor_contact}><Input value={vendor.contact} onChange={(e) => setVendorField("contact", e.target.value)} /></Field>
            <Field label="Email" htmlFor="po_vendor_email" error={fields.errors.po_vendor_email}><Input type="email" inputMode="email" value={vendor.email} onChange={(e) => setVendorField("email", e.target.value)} /></Field>
            <Field label="Phone" htmlFor="po_vendor_phone" error={fields.errors.po_vendor_phone}><Input type="tel" inputMode="tel" value={vendor.phone} onChange={(e) => setVendorField("phone", e.target.value)} /></Field>
            <Field label="Address" htmlFor="po_vendor_address" error={fields.errors.po_vendor_address}><Input value={vendor.address} onChange={(e) => setVendorField("address", e.target.value)} /></Field>
            <Field label="Website" htmlFor="po_vendor_url" error={fields.errors.po_vendor_url}><Input type="url" inputMode="url" placeholder="https://" value={vendor.url} onChange={(e) => setVendorField("url", e.target.value)} /></Field>
          </fieldset>
          <Field label="Notes on the PO" htmlFor="po_notes"><Textarea id="po_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 pt-4">
            <p className="text-sm">PO total <span className="tabular ml-2 font-serif text-2xl">{formatCents(total, currency)}</span></p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <LoadingButton type="submit" variant="gold" pending={pending} pendingLabel="Issuing…">Issue & email PO</LoadingButton>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
