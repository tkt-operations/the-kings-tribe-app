"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, FileUp, Paperclip, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Checkbox, Field, FieldError, Input, RequiredMark, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { focusFirstInvalidSoon, REVIEW_FIELDS_MESSAGE } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { isNavigationSignal } from "@/components/ui/use-action";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatCents, formatMoney, lineTotal, parseMoney, parseQuantity } from "@/lib/money";
import { checkReceiptFile, RECEIPT_ACCEPT, RECEIPT_MAX_FILES } from "@/lib/receipt-files";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { PriorityField } from "@/components/ui/priority-field";
import { comparePriority, countByPriority, isPriority } from "@/lib/priority";
import { buildRequisitionSchema, EMPTY_LINE_ITEM, estimatedTotal, type RequisitionInput } from "@/lib/validation/requisition";
import type { FormContext } from "@/lib/data/form-context";
import { prepareReceiptUploads, submitExternalRequisition, type SubmissionSummary } from "./actions";
import { FieldLookupNote, LookupTag, ProductLinkField, useProductLookups, type FillField } from "./product-link-field";

export function RequisitionForm({ token, context, stamp }: { token: string; context: FormContext; stamp: string }) {
  const [summary, setSummary] = useState<SubmissionSummary | null>(null);
  const [formKey, setFormKey] = useState(0);
  if (summary) {
    return <Confirmation summary={summary} currency={context.currency} onAnother={() => { setSummary(null); setFormKey((k) => k + 1); }} />;
  }
  return <FormBody key={formKey} token={token} context={context} stamp={stamp} onSubmitted={setSummary} />;
}

function FormBody({ token, context, stamp, onSubmitted }: { token: string; context: FormContext; stamp: string; onSubmitted: (s: SubmissionSummary) => void }) {
  const schema = useMemo(() => buildRequisitionSchema({ today: context.today, requestTypes: context.request_types }), [context]);
  const defaultType = context.request_types.find((t) => t.is_default) ?? context.request_types[0];
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  const form = useForm<RequisitionInput>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    shouldFocusError: false, // focusFirstInvalidSoon focuses in document order instead
    defaultValues: {
      requester_name: "",
      requester_email: "",
      requester_phone: "",
      department_head_name: "",
      department_id: context.restricted_department_id ?? (context.departments.length === 1 ? context.departments[0].id : ""),
      subcategory_id: "",
      request_type_id: defaultType?.id ?? "",
      cost_center_id: "",
      needed_by: "",
      budget_status: undefined,
      budget_explanation: "",
      justification: "",
      actual_purchase_amount: "",
      purchase_vendor: "",
      purchase_date: "",
      items: [{ ...EMPTY_LINE_ITEM }],
      certification_accepted: false as unknown as true,
      certification_name: "",
      sms_opt_in: false,
      receipt_count: 0,
    },
  });
  const { register, control, handleSubmit, setValue, setError, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const fieldIds = useRef<string[]>([]);
  useEffect(() => {
    fieldIds.current = fields.map((f) => f.id);
  }, [fields]);
  const product = useProductLookups(form, token, {
    indexOf: (fieldId) => fieldIds.current.indexOf(fieldId),
    ids: () => fieldIds.current,
  });

  const departmentId = useWatch({ control, name: "department_id" });
  const requestTypeId = useWatch({ control, name: "request_type_id" });
  const budgetStatus = useWatch({ control, name: "budget_status" });
  const items = useWatch({ control, name: "items" });
  const requesterName = useWatch({ control, name: "requester_name" });

  const department = context.departments.find((d) => d.id === departmentId);
  const requestType = context.request_types.find((t) => t.id === requestTypeId);
  const total = estimatedTotal((items ?? []).map((i) => ({ quantity: i?.quantity ?? "", estimated_unit_price: i?.estimated_unit_price ?? "" })));
  const costCenters = context.cost_centers.filter((c) => !c.department_id || c.department_id === departmentId);
  const showReceipts = Boolean(requestType?.requires_receipt_on_submission || requestType?.requires_purchase_details);

  function addFiles(list: FileList | null) {
    setFileError(null);
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      const check = checkReceiptFile(file);
      if (!check.ok) {
        setFileError(check.error);
        toast.error(check.error);
        continue;
      }
      if (next.length >= RECEIPT_MAX_FILES) {
        setFileError(`Attach at most ${RECEIPT_MAX_FILES} files.`);
        toast.error(`Attach at most ${RECEIPT_MAX_FILES} files.`);
        break;
      }
      next.push(file);
    }
    setFiles(next);
    setValue("receipt_count", next.length, { shouldValidate: true });
  }

  const submitValid = async (values: RequisitionInput, event?: React.BaseSyntheticEvent) => {
    if (inFlight.current) return; // a submission is already running
    inFlight.current = true;
    const formEl = (event?.target as HTMLFormElement | undefined) ?? null;
    const honeypotValue = (formEl?.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
    setSubmitError(null);
    try {
      let uploaded: { path: string; original_filename: string }[] = [];
      if (showReceipts && files.length) {
        setPhase("uploading");
        const prepared = await prepareReceiptUploads(token, files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
        if (!prepared.ok) throw new SubmitFailure(prepared.error);
        const supabase = createSupabaseBrowserClient();
        for (const [i, slot] of prepared.data.entries()) {
          const { error } = await supabase.storage.from("receipts").uploadToSignedUrl(slot.path, slot.signedToken, files[i], { contentType: slot.contentType });
          if (error) throw new SubmitFailure(`Receipt upload failed for ${files[i].name}. Please try again.`);
          uploaded.push({ path: slot.path, original_filename: slot.originalName });
        }
      } else {
        uploaded = [];
      }
      setPhase("submitting");
      const result = await submitExternalRequisition(token, { ...values, receipt_count: uploaded.length }, uploaded, stamp, honeypotValue);
      if (!result.ok) {
        const fieldErrors = Object.entries(result.fieldErrors ?? {});
        for (const [path, message] of fieldErrors) setError(path as Path<RequisitionInput>, { message });
        if (fieldErrors.length) focusFirstInvalidSoon(formRef.current);
        throw new SubmitFailure(result.error);
      }
      toast.success(`Requisition ${result.data.requisition_number} submitted successfully.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      onSubmitted(result.data);
    } catch (error) {
      if (isNavigationSignal(error)) throw error;
      if (!(error instanceof SubmitFailure)) console.error(error);
      const message = error instanceof SubmitFailure ? error.message : "Unable to submit requisition. Please review the form and try again.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    // A product link changed without leaving the field: clear the previous product's untouched details first.
    product.commitAll();
    return handleSubmit(submitValid, () => {
      toast.error(REVIEW_FIELDS_MESSAGE);
      focusFirstInvalidSoon(formRef.current);
    })(event);
  };

  const busy = phase !== "idle";

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={busy || undefined}>
      {/* Honeypot — hidden from people and assistive tech */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="rounded-[var(--radius-card)] bg-white p-1.5 shadow-sm shadow-navy/5">
        <Alert tone="warning" title="Requisition policy" className="border-0">{context.policy}</Alert>
      </div>

      <RequiredNote className="px-1" />

      <Section number={1} title="About you">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your full name" htmlFor="requester_name" required error={errors.requester_name?.message}>
            <Input id="requester_name" autoComplete="name" {...register("requester_name")} aria-invalid={!!errors.requester_name}
              onBlur={(e) => {
                register("requester_name").onBlur(e);
                if (!form.getValues("certification_name")) setValue("certification_name", e.target.value);
              }} />
          </Field>
          <Field label="Email" htmlFor="requester_email" required error={errors.requester_email?.message} hint="Updates about this request are sent here.">
            <Input id="requester_email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              {...register("requester_email")} aria-invalid={!!errors.requester_email} />
          </Field>
          <Field label="Phone" htmlFor="requester_phone" required error={errors.requester_phone?.message}>
            <Input id="requester_phone" type="tel" inputMode="tel" autoComplete="tel" {...register("requester_phone")} aria-invalid={!!errors.requester_phone} />
          </Field>
          <Field label="Department head" htmlFor="department_head_name" required error={errors.department_head_name?.message}>
            <div className="space-y-2">
              <Input id="department_head_name" autoComplete="off" {...register("department_head_name")} aria-invalid={!!errors.department_head_name} />
              <label className="flex items-center gap-2 text-sm text-navy/70">
                <Checkbox onChange={(e) => e.target.checked && setValue("department_head_name", requesterName ?? "", { shouldValidate: true })} />
                I am the department head
              </label>
            </div>
          </Field>
        </div>
      </Section>

      <Section number={2} title="Department & timing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" htmlFor="department_id" required error={errors.department_id?.message}>
            <Select id="department_id" {...register("department_id", { onChange: () => setValue("subcategory_id", "") })}
              disabled={Boolean(context.restricted_department_id)} aria-invalid={!!errors.department_id}>
              <option value="">Choose a department</option>
              {context.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Subcategory" htmlFor="subcategory_id" required error={errors.subcategory_id?.message}>
            <Select id="subcategory_id" {...register("subcategory_id")} disabled={!department} aria-invalid={!!errors.subcategory_id}>
              <option value="">{department ? "Choose a subcategory" : "Choose a department first"}</option>
              {(department?.subcategories ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Date submitted" htmlFor="date_submitted" hint="Recorded automatically when you submit.">
            <Input id="date_submitted" value={formatDate(context.today, "long")} readOnly disabled />
          </Field>
          <Field label="Date items / funds are needed" htmlFor="needed_by" required error={errors.needed_by?.message}>
            <Input id="needed_by" type="date" min={context.today} {...register("needed_by")} aria-invalid={!!errors.needed_by} />
          </Field>
        </div>
      </Section>

      <Section number={3} title="Request type">
        <fieldset role="radiogroup" aria-required="true" aria-invalid={errors.request_type_id ? true : undefined} aria-describedby={errors.request_type_id ? "request_type_id-error" : undefined}>
          <legend className="sr-only">Request type (required)</legend>
          <div className="grid gap-2.5">
            {context.request_types.map((t) => {
              const selected = t.id === requestTypeId;
              return (
                <label key={t.id} className={cn(
                  "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors",
                  selected ? "border-navy bg-navy/[0.03] ring-2 ring-gold" : "border-navy/15 hover:border-navy/30",
                )}>
                  <input type="radio" value={t.id} {...register("request_type_id")} className="mt-1 size-5 shrink-0 accent-navy" />
                  <span>
                    <span className="block font-bold">{t.name}{t.is_default ? <span className="ml-2 text-xs font-medium text-navy/50">Most common</span> : null}</span>
                    {t.description ? <span className="mt-0.5 block text-sm text-navy/65">{t.description}</span> : null}
                    {selected && t.help_text ? <span className="mt-2 block text-sm font-medium text-navy">{t.help_text}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
          <FieldError id="request_type_id-error" message={errors.request_type_id?.message} />
        </fieldset>

        {requestType?.requires_purchase_details ? (
          <div className="mt-5 grid gap-4 rounded-2xl bg-neutral-gray p-4 sm:grid-cols-3">
            <Field label="Actual amount paid" htmlFor="actual_purchase_amount" required error={errors.actual_purchase_amount?.message}>
              <MoneyInput id="actual_purchase_amount" {...register("actual_purchase_amount")} aria-invalid={!!errors.actual_purchase_amount} />
            </Field>
            <Field label="Vendor" htmlFor="purchase_vendor" required error={errors.purchase_vendor?.message}>
              <Input id="purchase_vendor" {...register("purchase_vendor")} aria-invalid={!!errors.purchase_vendor} />
            </Field>
            <Field label="Purchase date" htmlFor="purchase_date" required error={errors.purchase_date?.message}>
              <Input id="purchase_date" type="date" max={context.today} {...register("purchase_date")} aria-invalid={!!errors.purchase_date} />
            </Field>
          </div>
        ) : null}

        {showReceipts ? (
          <div className="mt-5">
            <p id="receipt-files-label" className="mb-2 text-sm font-medium">Itemized receipt{requestType?.requires_receipt_on_submission ? <RequiredMark /> : null}</p>
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/20 bg-white p-5 text-center hover:border-navy/40">
              <FileUp className="size-6 text-navy/60" aria-hidden />
              <span className="text-sm font-medium">Take a photo or choose a file</span>
              <span className="text-xs text-navy/55">PDF, JPEG, PNG or HEIC · up to 10 MB each · max {RECEIPT_MAX_FILES}</span>
              <input id="receipt_count" type="file" accept={RECEIPT_ACCEPT} multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                aria-labelledby="receipt-files-label" aria-required={requestType?.requires_receipt_on_submission || undefined}
                aria-invalid={fileError || errors.receipt_count ? true : undefined} aria-describedby={fileError || errors.receipt_count ? "receipt_count-error" : undefined} />
            </label>
            {files.length ? (
              <ul className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-navy/10">
                    <span className="flex min-w-0 items-center gap-2"><Paperclip className="size-4 shrink-0 text-navy/50" aria-hidden /><span className="truncate">{f.name}</span></span>
                    <button type="button" className="flex size-10 items-center justify-center rounded-lg hover:bg-navy/5" aria-label={`Remove ${f.name}`}
                      onClick={() => { const next = files.filter((_, j) => j !== i); setFiles(next); setValue("receipt_count", next.length, { shouldValidate: true }); }}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <FieldError id="receipt_count-error" live={Boolean(fileError)} message={fileError ?? errors.receipt_count?.message} />
          </div>
        ) : null}
      </Section>

      <Section number={4} title="Financial coding">
        <div className="grid gap-4">
          <Field label="Budget line / cost center" htmlFor="cost_center_id" required={requestType?.requires_cost_center} error={errors.cost_center_id?.message}>
            <Select id="cost_center_id" {...register("cost_center_id")} aria-invalid={!!errors.cost_center_id}>
              <option value="">{requestType?.requires_cost_center ? "Choose a budget line" : "Not sure / let Finance decide"}</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </Select>
          </Field>
          <fieldset role="radiogroup" aria-required="true" aria-invalid={errors.budget_status ? true : undefined} aria-describedby={errors.budget_status ? "budget_status-error" : undefined}>
            <legend className="mb-2 text-sm font-medium">Is this purchase within your approved ministry budget?<RequiredMark /></legend>
            <div className="grid grid-cols-3 gap-2">
              {(["yes", "no", "unsure"] as const).map((v) => (
                <label key={v} className={cn("flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-[15px] font-medium",
                  budgetStatus === v ? "border-navy bg-navy text-gold" : "border-navy/15 bg-white hover:border-navy/30")}>
                  <input type="radio" value={v} {...register("budget_status")} className="sr-only" />
                  {v === "yes" ? "Yes" : v === "no" ? "No" : "Unsure"}
                </label>
              ))}
            </div>
            <FieldError id="budget_status-error" message={errors.budget_status?.message} />
          </fieldset>
          {budgetStatus && budgetStatus !== "yes" ? (
            <Field label="Please explain" htmlFor="budget_explanation" required error={errors.budget_explanation?.message}>
              <Textarea id="budget_explanation" rows={3} {...register("budget_explanation")} aria-invalid={!!errors.budget_explanation} />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section number={5} title="Items requested">
        <div className="space-y-4">
          {fields.map((field, index) => {
            const item = items?.[index];
            const q = parseQuantity(item?.quantity ?? "");
            const p = parseMoney(item?.estimated_unit_price ?? "");
            const line = q !== null && p !== null ? formatCents(lineTotal(q, p), context.currency) : "—";
            const e = errors.items?.[index];
            const lookupLine = product.lines[field.id];
            const urlValue = item?.vendor_url ?? "";
            const label = (text: string, name: FillField) => <>{text}<LookupTag line={lookupLine} name={name} value={item?.[name]} urlValue={urlValue} /></>;
            const suggest = (name: FillField) => (
              <FieldLookupNote line={lookupLine} name={name} value={item?.[name]} currency={context.currency} urlValue={urlValue} onUse={() => product.applyFetched(field.id, name)} />
            );
            // Typing into a product field marks an auto-filled value as edited by the requester.
            const productField = (name: FillField) => register(`items.${index}.${name}`, { onChange: () => product.fieldEdited(field.id, name) });
            return (
              <div key={field.id} className="rounded-2xl border border-navy/12 bg-white p-4 ring-1 ring-navy/5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-navy/55">
                    Item {index + 1}
                    {isPriority(item?.priority) && item.priority !== "medium" ? <PriorityBadge priority={item.priority} size="sm" /> : null}
                  </p>
                  {fields.length > 1 ? (
                    <button type="button" onClick={() => { product.forget(field.id); remove(index); }} className="flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-navy/70 hover:bg-navy/5">
                      <Trash2 className="size-4" aria-hidden /> Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-6">
                  <ProductLinkField
                    className="sm:col-span-6"
                    index={index}
                    line={lookupLine}
                    now={product.now}
                    urlValue={urlValue}
                    error={e?.vendor_url?.message}
                    registration={register(`items.${index}.vendor_url`, {
                      onChange: (event) => product.urlChanged(field.id, event.target.value),
                      onBlur: () => product.commitUrl(field.id),
                    })}
                    onGetDetails={() => product.getDetails(field.id)}
                    onUndo={() => product.undoClear(field.id)}
                  />
                  <Field className="sm:col-span-6" label={label("Item description", "description")} htmlFor={`items.${index}.description`} required error={e?.description?.message}>
                    <Input id={`items.${index}.description`} {...productField("description")} aria-invalid={!!e?.description} />
                    {suggest("description")}
                  </Field>
                  <Field className="sm:col-span-6" label="Specifications" htmlFor={`items.${index}.specifications`} error={e?.specifications?.message}>
                    <Input id={`items.${index}.specifications`} placeholder="Material, features, details…" {...register(`items.${index}.specifications`)} />
                  </Field>
                  <Field className="sm:col-span-2" label={label("Brand (optional)", "requested_brand")} htmlFor={`items.${index}.requested_brand`} error={e?.requested_brand?.message}>
                    <Input id={`items.${index}.requested_brand`} maxLength={120} {...productField("requested_brand")} />
                    {suggest("requested_brand")}
                  </Field>
                  <Field className="sm:col-span-2" label={label("Model / part number (optional)", "requested_model")} htmlFor={`items.${index}.requested_model`} error={e?.requested_model?.message}>
                    <Input id={`items.${index}.requested_model`} maxLength={100} {...productField("requested_model")} />
                    {suggest("requested_model")}
                  </Field>
                  <Field className="sm:col-span-2" label={label("SKU / item number (optional)", "requested_sku")} htmlFor={`items.${index}.requested_sku`} error={e?.requested_sku?.message}>
                    <Input id={`items.${index}.requested_sku`} maxLength={100} {...productField("requested_sku")} />
                    {suggest("requested_sku")}
                  </Field>
                  <Field className="sm:col-span-2" label={label("Color (optional)", "color")} htmlFor={`items.${index}.color`}>
                    <Input id={`items.${index}.color`} {...productField("color")} />
                    {suggest("color")}
                  </Field>
                  <Field className="sm:col-span-2" label={label("Size (optional)", "size")} htmlFor={`items.${index}.size`}>
                    <Input id={`items.${index}.size`} {...productField("size")} />
                    {suggest("size")}
                  </Field>
                  <Field className="sm:col-span-2" label={label("Vendor name", "vendor_name")} htmlFor={`items.${index}.vendor_name`} error={e?.vendor_name?.message}>
                    <Input id={`items.${index}.vendor_name`} {...productField("vendor_name")} />
                    {suggest("vendor_name")}
                  </Field>
                  <Field className="sm:col-span-2" label="Quantity" htmlFor={`items.${index}.quantity`} required error={e?.quantity?.message}>
                    <Input id={`items.${index}.quantity`} inputMode="decimal" className="tabular" {...register(`items.${index}.quantity`)} aria-invalid={!!e?.quantity} />
                  </Field>
                  <Field className="sm:col-span-2" label={label("Est. unit price", "estimated_unit_price")} htmlFor={`items.${index}.estimated_unit_price`} required error={e?.estimated_unit_price?.message}>
                    <MoneyInput id={`items.${index}.estimated_unit_price`} {...productField("estimated_unit_price")} aria-invalid={!!e?.estimated_unit_price} />
                    {suggest("estimated_unit_price")}
                  </Field>
                  <div className="sm:col-span-2">
                    <p className="mb-1.5 text-sm font-medium">Estimated total</p>
                    <p className="tabular flex h-12 items-center justify-end rounded-xl bg-neutral-gray px-3.5 text-lg font-bold">{line}</p>
                  </div>
                  <PriorityField
                    className="sm:col-span-6"
                    id={`items.${index}.priority`}
                    value={isPriority(item?.priority) ? item.priority : undefined}
                    error={e?.priority?.message}
                    inputProps={(p) => ({ ...register(`items.${index}.priority`), value: p })}
                  />
                  {item?.priority === "essential" ? (
                    <Field className="sm:col-span-6" label="Why is this item essential?" htmlFor={`items.${index}.essential_justification`} required
                      error={e?.essential_justification?.message} hint="Briefly explain the operational impact if this item is not purchased.">
                      <Textarea id={`items.${index}.essential_justification`} rows={2} maxLength={500} {...register(`items.${index}.essential_justification`)} />
                    </Field>
                  ) : null}
                  <Field className="sm:col-span-6" label="Notes (optional)" htmlFor={`items.${index}.notes`}>
                    <Input id={`items.${index}.notes`} {...register(`items.${index}.notes`)} />
                  </Field>
                </div>
              </div>
            );
          })}
          <Button type="button" variant="gold" size="lg" className="w-full" onClick={() => append({ ...EMPTY_LINE_ITEM })} disabled={fields.length >= 50}>
            <Plus className="size-5" aria-hidden /> Add Item
          </Button>
          <FieldError message={errors.items?.message ?? errors.items?.root?.message} live />
          <div className="flex items-center justify-between rounded-2xl bg-navy px-5 py-4 text-white">
            <span className="text-sm font-medium text-white/75">Estimated requisition total</span>
            <span className="tabular font-serif text-3xl text-gold">{total === null ? "—" : formatCents(total, context.currency)}</span>
          </div>
          {requestType?.max_total ? <p className="text-sm text-navy/60">{requestType.name} requests are limited to {formatMoney(requestType.max_total, context.currency)}.</p> : null}
        </div>
      </Section>

      <Section number={6} title="Purpose / ministry justification">
        <Field label="Describe how these items or funds will support your ministry or church activity." htmlFor="justification" required error={errors.justification?.message}>
          <Textarea id="justification" rows={5} {...register("justification")} aria-invalid={!!errors.justification} />
        </Field>
      </Section>

      <Section number={7} title="Certification & updates">
        <div className="space-y-4">
          <label className="flex gap-3 rounded-2xl bg-neutral-gray p-4">
            <Checkbox id="certification_accepted" {...register("certification_accepted")} className="mt-0.5" aria-required="true"
              aria-invalid={errors.certification_accepted ? true : undefined} aria-describedby={errors.certification_accepted ? "certification_accepted-error" : undefined} />
            <span className="text-[15px] leading-relaxed">
              I certify that the information provided in this request is accurate and that the requested purchase is for authorized church/ministry purposes.<RequiredMark />
            </span>
          </label>
          <FieldError id="certification_accepted-error" message={errors.certification_accepted?.message} />
          <Field label="Your name" htmlFor="certification_name" required error={errors.certification_name?.message}
            hint={`Recorded with the date and time of submission (${formatDateTime(new Date().toISOString(), context.timezone)}). This is a record of your certification, not a legally binding electronic signature.`}>
            <Input id="certification_name" autoComplete="name" {...register("certification_name")} aria-invalid={!!errors.certification_name} />
          </Field>
          <label className="flex gap-3">
            <Checkbox {...register("sms_opt_in")} className="mt-0.5" />
            <span className="text-sm text-navy/75">
              Also text me status updates at the phone number above. Email remains the main channel. Message and data rates may apply; reply STOP to opt out.
            </span>
          </label>
        </div>
      </Section>

      {submitError ? <Alert tone="error" title="Your request was not submitted">{submitError}</Alert> : null}

      <LoadingButton type="submit" variant="primary" size="lg" className="h-14 w-full text-base" pending={busy}
        pendingLabel={phase === "uploading" ? "Uploading receipts…" : "Submitting…"}>
        Submit requisition
      </LoadingButton>
    </form>
  );
}

/** A failure whose message is already safe and specific for the requester. */
class SubmitFailure extends Error {}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="pt-5 sm:pt-6">
        <h2 className="mb-5 flex items-center gap-3 font-serif text-2xl">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold font-sans text-sm font-bold text-navy">{number}</span>
          {title}
        </h2>
        {children}
      </CardBody>
    </Card>
  );
}

function MoneyInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-3 text-navy/45" aria-hidden>$</span>
      <Input inputMode="decimal" autoComplete="off" placeholder="0.00" className="tabular pl-7" {...props} />
    </div>
  );
}

function Confirmation({ summary, currency, onAnother }: { summary: SubmissionSummary; currency: string; onAnother: () => void }) {
  return (
    <Card>
      <CardBody className="pt-8 text-center sm:px-10 sm:pt-10">
        <CheckCircle2 className="mx-auto size-12 text-kingdom-green" aria-hidden />
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-navy/55">Request submitted</p>
        <h2 className="tabular mt-2 font-serif text-4xl">{summary.requisition_number}</h2>
        <p className="mx-auto mt-3 max-w-md text-navy/70">A confirmation has been emailed to you. Keep this number for reference — you can reply to the confirmation email with questions.</p>
        <dl className="mx-auto mt-8 max-w-md divide-y divide-navy/10 text-left text-[15px]">
          {[
            ["Department", `${summary.department_name} · ${summary.subcategory_name}`],
            ["Request type", summary.request_type_name],
            ["Submitted", formatDate(summary.submitted_at.slice(0, 10), "long")],
            ["Date needed", formatDate(summary.needed_by, "long")],
            ["Estimated total", formatMoney(summary.estimated_total, currency)],
            ["Status", "Submitted"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-navy/60">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        {countByPriority(summary.items).essential > 0 ? (
          <p className="mx-auto mt-6 max-w-md rounded-xl bg-energy-orange/10 px-3 py-2 text-left text-sm font-medium">
            This request includes {countByPriority(summary.items).essential} Essential item{countByPriority(summary.items).essential === 1 ? "" : "s"}. Finance will see your explanation.
          </p>
        ) : null}
        <ul className="mx-auto mt-4 max-w-md space-y-2 text-left text-sm text-navy/70">
          {[...summary.items].sort((a, b) => comparePriority(a.priority, b.priority) || a.line_number - b.line_number).map((i) => (
            <li key={i.line_number} className="flex items-start justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2">
                {isPriority(i.priority) ? <PriorityBadge priority={i.priority} size="sm" /> : null}
                <span className="truncate">{i.description} × {i.quantity.replace(/\.00$/, "")}</span>
              </span>
              <span className="tabular">{formatMoney(i.estimated_total, currency)}</span>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="mt-8" onClick={onAnother}>Submit another request</Button>
      </CardBody>
    </Card>
  );
}
