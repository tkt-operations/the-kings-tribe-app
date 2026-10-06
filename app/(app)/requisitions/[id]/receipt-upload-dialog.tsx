"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldError, Input, RequiredMark, RequiredNote, Select, Textarea } from "@/components/ui/field";
import { useFieldErrors } from "@/components/ui/form-feedback";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/ui/use-action";
import { checkReceiptFile, RECEIPT_ACCEPT, RECEIPT_MAX_FILES } from "@/lib/receipt-files";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { rules, validate } from "@/lib/validation/form";
import { registerReceipt } from "./actions";

const EMPTY_DETAILS = { vendor_name: "", purchase_date: "", total_amount: "", reference: "", notes: "" };

/**
 * Uploads go straight from the browser to the PRIVATE receipts bucket under
 * requisitions/<id>/, authorised by the user's session and Storage policies.
 * The server then verifies each object and records the receipt.
 */
export function ReceiptUploadDialog({ requisitionId, purchaseOrders }: { requisitionId: string; purchaseOrders: { id: string; po_number: string }[] }) {
  const defaultPo = purchaseOrders.length === 1 ? purchaseOrders[0].id : "";
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [details, setDetails] = useState({ purchase_order_id: defaultPo, ...EMPTY_DETAILS });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fields = useFieldErrors();
  const toast = useToast();
  const { pending, error, run } = useAction();

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const check = checkReceiptFile(f);
      if (!check.ok) {
        fields.setErrors((prev) => ({ ...prev, rc_files: check.error }));
        toast.error(check.error);
        continue;
      }
      if (next.length >= RECEIPT_MAX_FILES) {
        const message = `Attach at most ${RECEIPT_MAX_FILES} files.`;
        fields.setErrors((prev) => ({ ...prev, rc_files: message }));
        toast.error(message);
        break;
      }
      next.push(f);
      fields.clear("rc_files");
    }
    setFiles(next);
  }

  function setDetail(key: keyof typeof details, id: string | null, value: string) {
    setDetails({ ...details, [key]: value });
    if (id) fields.clear(id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadInFlight.current || pending) return;
    setUploadError(null);
    const errors = validate({
      rc_files: [files.length ? "ok" : "", rules.required("Choose at least one receipt file.")],
      rc_date: [details.purchase_date, rules.date()],
      rc_total: [details.total_amount, rules.money("Enter the receipt total like 24.99.")],
    });
    if (!fields.check(errors, formRef.current)) return;

    uploadInFlight.current = true;
    setUploading(true);
    const uploaded: { path: string; original_filename: string }[] = [];
    try {
      const supabase = createSupabaseBrowserClient();
      for (const file of files) {
        const check = checkReceiptFile(file);
        if (!check.ok) throw new Error(check.error);
        const path = `requisitions/${requisitionId}/${crypto.randomUUID()}.${check.ext}`;
        const { error: storageError } = await supabase.storage.from("receipts").upload(path, file, { contentType: check.mime, upsert: false });
        if (storageError) throw new Error(`Receipt upload failed for ${file.name}. Please try again.`);
        uploaded.push({ path, original_filename: file.name.slice(0, 255) });
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Receipt upload failed. Please try again.";
      setUploadError(message);
      toast.error(message);
      return;
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
    run(() => registerReceipt(requisitionId, { ...details, purchase_order_id: details.purchase_order_id || null, files: uploaded }), {
      errorMessage: "Receipt upload failed. Please try again.",
      onSuccess: () => {
        setOpen(false);
        setFiles([]);
        setDetails({ purchase_order_id: defaultPo, ...EMPTY_DETAILS });
      },
    });
  }

  const busy = uploading || pending;
  const formError = uploadError ?? error;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Upload className="size-4" aria-hidden /> Upload receipt</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Upload receipt" description="Receipts are stored privately. Uploading does not mark anything purchased — reconcile the receipt afterwards.">
        <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <RequiredNote />
          <div>
            <p id="rc_files-label" className="mb-1.5 text-sm font-medium">Receipt files<RequiredMark /></p>
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/20 p-5 text-center hover:border-navy/40">
              <Upload className="size-6 text-navy/60" aria-hidden />
              <span className="text-sm font-medium">Take a photo or choose files</span>
              <span className="text-xs text-navy/55">PDF, JPEG, PNG or HEIC · 10 MB max each · up to {RECEIPT_MAX_FILES}</span>
              <input id="rc_files" type="file" multiple accept={RECEIPT_ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }}
                aria-labelledby="rc_files-label" aria-required="true" aria-invalid={fields.errors.rc_files ? true : undefined} aria-describedby={fields.errors.rc_files ? "rc_files-error" : undefined} />
            </label>
            <FieldError id="rc_files-error" message={fields.errors.rc_files} />
          </div>
          {files.length ? (
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-gray px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Paperclip className="size-4 shrink-0" aria-hidden /><span className="truncate">{f.name}</span></span>
                  <button type="button" className="flex size-9 items-center justify-center rounded-lg hover:bg-navy/10" aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {purchaseOrders.length ? (
              <Field label="Purchase Order" htmlFor="rc_po">
                <Select value={details.purchase_order_id} onChange={(e) => setDetail("purchase_order_id", null, e.target.value)}>
                  <option value="">None</option>
                  {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="Vendor" htmlFor="rc_vendor"><Input value={details.vendor_name} maxLength={200} onChange={(e) => setDetail("vendor_name", null, e.target.value)} /></Field>
            <Field label="Purchase date" htmlFor="rc_date" error={fields.errors.rc_date}><Input type="date" value={details.purchase_date} onChange={(e) => setDetail("purchase_date", "rc_date", e.target.value)} /></Field>
            <Field label="Receipt total" htmlFor="rc_total" error={fields.errors.rc_total}><Input inputMode="decimal" className="tabular" placeholder="0.00" value={details.total_amount} onChange={(e) => setDetail("total_amount", "rc_total", e.target.value)} /></Field>
            <Field label="Receipt / invoice #" htmlFor="rc_ref"><Input value={details.reference} maxLength={200} onChange={(e) => setDetail("reference", null, e.target.value)} /></Field>
          </div>
          <Field label="Notes" htmlFor="rc_notes"><Textarea rows={2} value={details.notes} maxLength={2000} onChange={(e) => setDetail("notes", null, e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <LoadingButton type="submit" pending={busy} pendingLabel={uploading ? "Uploading…" : "Saving…"}>Upload receipt</LoadingButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
