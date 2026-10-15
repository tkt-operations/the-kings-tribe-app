"use client";

import { useRef, useState } from "react";
import { FilePenLine, Plus, Undo2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { LoadingButton } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import {
  FieldLookupNote, LookupTag, ProductLinkField, useLineLookups, type FillField, type LineState,
} from "@/components/product/product-lookup";
import {
  AMENDMENT_REASON_MAX, AMENDMENT_REASON_MIN, buildAmendmentChanges, changedFields, displayValue, EMPTY_LINE, FIELD_LABELS,
  type AmendmentChange, type ExistingLine, type LineDraft,
} from "@/lib/amendments";
import { formatCents, lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { ESSENTIAL_JUSTIFICATION_MIN, PRIORITIES, PRIORITY_LABELS } from "@/lib/priority";
import { amendRequisition } from "./actions";
import { getAmendmentProductDetails } from "./product-actions";

export interface AmendableLine extends ExistingLine {
  /** The product link was verified at submission: it cannot change (remove the line and add a new one). */
  linkLocked: boolean;
}

type Errors = Record<string, string>;
interface NewLine { key: string; draft: LineDraft }

function lineCents(l: LineDraft): bigint {
  const q = parseQuantity(l.quantity);
  const p = parseMoney(l.estimated_unit_price);
  return q === null || p === null ? 0n : lineTotal(q, p);
}

function validateLine(key: string, l: LineDraft, errors: Errors) {
  if (l.description.trim().length < 2) errors[`${key}.description`] = "Describe the item (at least 2 characters).";
  if (parseQuantity(l.quantity) === null) errors[`${key}.quantity`] = "Enter a quantity greater than 0.";
  if (parseMoney(l.estimated_unit_price) === null) errors[`${key}.estimated_unit_price`] = "Enter an amount like 24.99.";
  if (l.vendor_url.trim() && !/^https?:\/\//i.test(l.vendor_url.trim())) errors[`${key}.vendor_url`] = "The product link must start with https://";
  if (l.priority === "essential" && l.essential_justification.trim().length < ESSENTIAL_JUSTIFICATION_MIN) {
    errors[`${key}.essential_justification`] = `Explain why this item is essential (at least ${ESSENTIAL_JUSTIFICATION_MIN} characters).`;
  }
}

/**
 * Editable fields for one line, laid out like the request form's item card,
 * with the same product link auto-fill (Get details, Filled / Edited tags,
 * "Use fetched value", previous-product notices).
 */
function LineFields({ id, value, onChange, errors, currency, lookup, linkLocked = false }: {
  id: string; value: LineDraft; onChange: (v: LineDraft) => void; errors: Errors; currency: string;
  lookup: {
    line: LineState | undefined; now: number; onGetDetails: () => void; onUrlChange: (v: string) => void; onUrlBlur: () => void;
    onUndo: () => void; onEdited: (name: FillField) => void; onUse: (name: FillField) => void;
  };
  linkLocked?: boolean;
}) {
  const set = (field: keyof LineDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    onChange({ ...value, [field]: e.target.value } as LineDraft);
    if (FILLABLE.has(field as FillField)) lookup.onEdited(field as FillField);
  };
  const f = (field: keyof LineDraft) => ({ htmlFor: `${id}_${field}`, error: errors[`${id}.${field}`] });
  const label = (text: string, name: FillField) => <>{text}<LookupTag line={lookup.line} name={name} value={value[name]} urlValue={value.vendor_url} /></>;
  const note = (name: FillField) => (
    <FieldLookupNote line={lookup.line} name={name} value={value[name]} currency={currency} urlValue={value.vendor_url} onUse={() => lookup.onUse(name)} />
  );
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <ProductLinkField
        className="sm:col-span-6"
        index={0}
        inputId={`${id}_vendor_url`}
        readOnly={linkLocked}
        line={lookup.line}
        now={lookup.now}
        error={errors[`${id}.vendor_url`]}
        urlValue={value.vendor_url}
        registration={{
          value: value.vendor_url,
          maxLength: 2000,
          onChange: (e) => { onChange({ ...value, vendor_url: e.target.value }); lookup.onUrlChange(e.target.value); },
          onBlur: lookup.onUrlBlur,
        }}
        onGetDetails={lookup.onGetDetails}
        onUndo={lookup.onUndo}
      />
      <Field label={label("Description", "description")} required className="sm:col-span-6" {...f("description")}>
        <Input maxLength={300} value={value.description} onChange={set("description")} />
      </Field>
      {note("description")}
      <Field label="Quantity" required className="sm:col-span-2" {...f("quantity")}>
        <Input inputMode="decimal" value={value.quantity} onChange={set("quantity")} />
      </Field>
      <div className="sm:col-span-2">
        <Field label={label("Unit price", "estimated_unit_price")} required {...f("estimated_unit_price")}>
          <Input inputMode="decimal" value={value.estimated_unit_price} onChange={set("estimated_unit_price")} />
        </Field>
        {note("estimated_unit_price")}
      </div>
      <Field label="Priority" required className="sm:col-span-2" {...f("priority")}>
        <Select value={value.priority} onChange={set("priority")}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </Select>
      </Field>
      {value.priority === "essential" ? (
        <Field label="Why is this item essential?" required className="sm:col-span-6" {...f("essential_justification")}>
          <Textarea rows={2} maxLength={500} value={value.essential_justification} onChange={set("essential_justification")} />
        </Field>
      ) : null}
      <div className="sm:col-span-3">
        <Field label={label("Vendor", "vendor_name")} {...f("vendor_name")}>
          <Input maxLength={200} value={value.vendor_name} onChange={set("vendor_name")} />
        </Field>
        {note("vendor_name")}
      </div>
      <div className="sm:col-span-3">
        <Field label={label("SKU / product number", "requested_sku")} {...f("requested_sku")}>
          <Input maxLength={100} value={value.requested_sku} onChange={set("requested_sku")} />
        </Field>
        {note("requested_sku")}
      </div>
      <div className="sm:col-span-3">
        <Field label={label("Brand", "requested_brand")} {...f("requested_brand")}>
          <Input maxLength={120} value={value.requested_brand} onChange={set("requested_brand")} />
        </Field>
        {note("requested_brand")}
      </div>
      <div className="sm:col-span-3">
        <Field label={label("Model", "requested_model")} {...f("requested_model")}>
          <Input maxLength={100} value={value.requested_model} onChange={set("requested_model")} />
        </Field>
        {note("requested_model")}
      </div>
      <Field label="Specifications" className="sm:col-span-6" {...f("specifications")}>
        <Input maxLength={2000} value={value.specifications} onChange={set("specifications")} />
      </Field>
      <div className="sm:col-span-2">
        <Field label={label("Color", "color")} {...f("color")}>
          <Input maxLength={60} value={value.color} onChange={set("color")} />
        </Field>
        {note("color")}
      </div>
      <div className="sm:col-span-2">
        <Field label={label("Size", "size")} {...f("size")}>
          <Input maxLength={60} value={value.size} onChange={set("size")} />
        </Field>
        {note("size")}
      </div>
      <Field label="Notes" className="sm:col-span-6" {...f("notes")}>
        <Textarea rows={2} maxLength={2000} value={value.notes} onChange={set("notes")} />
      </Field>
    </div>
  );
}

const FILLABLE = new Set<FillField>(["description", "requested_brand", "requested_model", "requested_sku", "vendor_name", "color", "size", "estimated_unit_price"]);

/**
 * Amend a submitted requisition (staff only). Lines keep their identity:
 * edits and removals are recorded field by field with the reason, and removed
 * lines are kept (never deleted). A summary of every change is shown before
 * anything is saved. Product links use the same best-effort auto-fill as the
 * request form.
 */
export function AmendDialog({ requisitionId, lines, currency, estimatedTotal }: {
  requisitionId: string;
  lines: AmendableLine[];
  currency: string;
  /** Current estimated total (decimal string). */
  estimatedTotal: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [edited, setEditedState] = useState<Record<string, LineDraft>>({});
  const [removed, setRemoved] = useState<Record<string, string>>({});
  const [added, setAddedState] = useState<NewLine[]>([]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [changes, setChanges] = useState<AmendmentChange[]>([]);
  const { pending, error, run } = useAction();
  const money = (cents: bigint) => formatCents(cents, currency);
  const moneyText = (v: string) => { const c = parseMoney(v); return c === null ? v : money(c); };

  // Synchronous mirrors: the lookup engine reads and writes line values from event handlers.
  const editedRef = useRef<Record<string, LineDraft>>({});
  const addedRef = useRef<NewLine[]>([]);
  const removedRef = useRef<Record<string, string>>({});
  const nextKey = useRef(0);
  const setEdited = (next: Record<string, LineDraft>) => { editedRef.current = next; setEditedState(next); };
  const setAdded = (next: NewLine[]) => { addedRef.current = next; setAddedState(next); };
  const setRemovedLines = (next: Record<string, string>) => { removedRef.current = next; setRemoved(next); };
  const draftFor = (key: string): LineDraft | undefined =>
    editedRef.current[key] ?? addedRef.current.find((a) => a.key === key)?.draft ?? lines.find((l) => l.id === key);
  const writeDraft = (key: string, draft: LineDraft) => {
    if (addedRef.current.some((a) => a.key === key)) setAdded(addedRef.current.map((a) => (a.key === key ? { ...a, draft } : a)));
    else setEdited({ ...editedRef.current, [key]: draft });
  };

  const product = useLineLookups({
    get: (key, name) => String(draftFor(key)?.[name] ?? ""),
    set: (key, name, value) => { const d = draftFor(key); if (d) writeDraft(key, { ...d, [name]: value }); },
    setToken: () => {}, // amendments record no lookup evidence
    exists: (key) => (lines.some((l) => l.id === key) && !(key in removedRef.current)) || addedRef.current.some((a) => a.key === key),
    keys: () => [...lines.filter((l) => !(l.id in removedRef.current)).map((l) => l.id), ...addedRef.current.map((a) => a.key)],
    fetch: (url) => getAmendmentProductDetails(requisitionId, url),
    fieldId: (key, name) => `${key}_${name}`,
  });

  const lookupProps = (key: string) => ({
    line: product.lines[key],
    now: product.now,
    onGetDetails: () => void product.getDetails(key),
    onUrlChange: (v: string) => product.urlChanged(key, v),
    onUrlBlur: () => product.commitUrl(key),
    onUndo: () => product.undoClear(key),
    onEdited: (name: FillField) => product.fieldEdited(key, name),
    onUse: (name: FillField) => product.applyFetched(key, name),
  });

  function start() {
    for (const key of [...Object.keys(editedRef.current), ...addedRef.current.map((a) => a.key)]) product.forget(key);
    setEdited(Object.fromEntries(lines.map((l) => [l.id, { ...l }])));
    setRemovedLines({});
    setAdded([]);
    setReason("");
    setErrors({});
    setStep("edit");
    setOpen(true);
  }

  const draftOf = (l: AmendableLine) => edited[l.id] ?? l;
  const revisedTotal = sumCents([
    ...lines.filter((l) => !(l.id in removed)).map((l) => lineCents(draftOf(l))),
    ...added.map((a) => lineCents(a.draft)),
  ]);

  function review(e: React.FormEvent) {
    e.preventDefault();
    product.commitAll(); // a link changed without leaving the field: clear untouched values first
    const editedNow = editedRef.current;
    const addedNow = addedRef.current.map((a) => a.draft);
    const errs: Errors = {};
    for (const l of lines) {
      const d = editedNow[l.id] ?? l;
      if (!(l.id in removed) && Object.keys(changedFields(l, d)).length) validateLine(l.id, d, errs);
    }
    addedRef.current.forEach((a) => validateLine(a.key, a.draft, errs));
    if (reason.trim().length < AMENDMENT_REASON_MIN) errs.reason = `Explain the reason for this amendment (at least ${AMENDMENT_REASON_MIN} characters).`;
    if (lines.every((l) => l.id in removed) && addedNow.length === 0) errs.form = "A requisition must keep at least one line item.";
    const list = buildAmendmentChanges(lines, editedNow, removed, addedNow);
    if (list.length === 0) errs.form = "Make at least one change before reviewing.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setChanges(list);
    setStep("review");
  }

  function submit() {
    run(() => amendRequisition(requisitionId, { reason: reason.trim(), changes }), {
      errorMessage: "Unable to save the amendment. Please try again.",
      onSuccess: () => setOpen(false),
    });
  }

  const lineById = new Map(lines.map((l) => [l.id, l]));

  return (
    <>
      <Button variant="secondary" onClick={start}>
        <FilePenLine className="size-4" aria-hidden /> Amend requisition
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title={step === "edit" ? "Amend requisition" : "Review amendment"}
        description={step === "edit"
          ? "Change, add or remove line items. Nothing is deleted: every change is kept in the amendment history with your reason. Changed and new lines go back to review."
          : "Check every change before saving. This creates a new revision of the requisition."}>
        {step === "edit" ? (
          <form className="space-y-5" onSubmit={review} noValidate>
            {error ? <Alert tone="error">{error}</Alert> : null}
            {errors.form ? <Alert tone="error">{errors.form}</Alert> : null}
            <RequiredNote />
            {lines.map((l) => (
              <fieldset key={l.id} className={`rounded-2xl border p-4 ${l.id in removed ? "border-navy/10 bg-neutral-gray/60" : "border-navy/10"}`}>
                <legend className="px-1 text-sm font-bold">Line {l.line}{l.id in removed ? <Badge tone="negative" className="ml-2">Removed</Badge> : null}</legend>
                {l.id in removed ? (
                  <div className="space-y-3">
                    <p className="text-sm text-navy/70 line-through">{l.description}</p>
                    <Field label="Reason for removing this line" htmlFor={`${l.id}_remove_reason`} hint="Optional — the amendment reason is used if left blank.">
                      <Input maxLength={1000} value={removed[l.id]} onChange={(e) => setRemovedLines({ ...removed, [l.id]: e.target.value })} />
                    </Field>
                    <Button size="sm" variant="ghost" onClick={() => { const next = { ...removed }; delete next[l.id]; setRemovedLines(next); }}>
                      <Undo2 className="size-4" aria-hidden /> Keep this line
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <LineFields id={l.id} value={draftOf(l)} errors={errors} currency={currency} linkLocked={l.linkLocked}
                      lookup={lookupProps(l.id)} onChange={(v) => setEdited({ ...editedRef.current, [l.id]: v })} />
                    <Button size="sm" variant="ghost" onClick={() => { product.forget(l.id); setRemovedLines({ ...removed, [l.id]: "" }); }}>
                      <X className="size-4" aria-hidden /> Remove from requisition
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
            {added.map((a) => (
              <fieldset key={a.key} className="rounded-2xl border border-gold/60 p-4">
                <legend className="px-1 text-sm font-bold">New line <Badge tone="info" className="ml-2">New</Badge></legend>
                <div className="space-y-3">
                  <LineFields id={a.key} value={a.draft} errors={errors} currency={currency} lookup={lookupProps(a.key)}
                    onChange={(v) => setAdded(addedRef.current.map((x) => (x.key === a.key ? { ...x, draft: v } : x)))} />
                  <Button size="sm" variant="ghost" onClick={() => { product.forget(a.key); setAdded(addedRef.current.filter((x) => x.key !== a.key)); }}>
                    <X className="size-4" aria-hidden /> Discard new line
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button variant="secondary" onClick={() => setAdded([...addedRef.current, { key: `new${nextKey.current++}`, draft: { ...EMPTY_LINE } }])}>
              <Plus className="size-4" aria-hidden /> Add line item
            </Button>
            <Field label="Reason for this amendment" htmlFor="amend_reason" required error={errors.reason}
              hint="For example: “Requester called to correct the quantity.” Shown in the amendment history.">
              <Textarea rows={3} maxLength={AMENDMENT_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="tabular text-sm text-navy/70">Estimated total: {moneyText(estimatedTotal)} → <strong>{money(revisedTotal)}</strong></p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Review changes</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <ul className="space-y-3" aria-label="Changes in this amendment">
              {changes.map((c, i) => {
                const line = c.op === "add" ? null : lineById.get(c.item_id);
                return (
                  <li key={i} className="rounded-2xl border border-navy/10 p-3 text-sm">
                    {c.op === "update" && line ? (
                      <>
                        <p className="font-bold">Line {line.line}: {line.description} <Badge tone="attention" className="ml-1">Changed</Badge></p>
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(c.fields).map(([field, value]) => (
                            <li key={field}>
                              <span className="text-navy/60">{FIELD_LABELS[field as keyof typeof FIELD_LABELS]}:</span>{" "}
                              <span className="line-through text-navy/55">{displayValue(field, line[field as keyof LineDraft], moneyText)}</span>{" → "}
                              <strong>{displayValue(field, value, moneyText)}</strong>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : c.op === "remove" && line ? (
                      <p><strong>Line {line.line}: {line.description}</strong> <Badge tone="negative" className="ml-1">Removed</Badge>
                        <span className="block text-navy/60">Reason: {c.reason || reason.trim()}</span></p>
                    ) : c.op === "add" ? (
                      <p><strong>{c.fields.description}</strong> <Badge tone="info" className="ml-1">New</Badge>
                        <span className="tabular block text-navy/60">{displayValue("quantity", c.fields.quantity, moneyText)} × {displayValue("estimated_unit_price", c.fields.estimated_unit_price, moneyText)} · {PRIORITY_LABELS[c.fields.priority as keyof typeof PRIORITY_LABELS]}{c.fields.requested_sku ? ` · SKU ${c.fields.requested_sku}` : ""}</span></p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm"><span className="text-navy/60">Reason:</span> {reason.trim()}</p>
            <p className="tabular text-sm">Estimated total: <span className="line-through text-navy/55">{moneyText(estimatedTotal)}</span> → <strong>{money(revisedTotal)}</strong></p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("edit")} disabled={pending}>Back to edit</Button>
              <LoadingButton onClick={submit} pending={pending} pendingLabel="Saving…">Submit amendment</LoadingButton>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
