"use client";

import { useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { useAction } from "@/components/ui/use-action";
import { checkReceiptFile, RECEIPT_ACCEPT, RECEIPT_MAX_FILES } from "@/lib/receipt-files";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { registerReceipt } from "./actions";

/**
 * Uploads go straight from the browser to the PRIVATE receipts bucket under
 * requisitions/<id>/, authorised by the user's session and Storage policies.
 * The server then verifies each object and records the receipt.
 */
export function ReceiptUploadDialog({ requisitionId, purchaseOrders }: { requisitionId: string; purchaseOrders: { id: string; po_number: string }[] }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [details, setDetails] = useState({ purchase_order_id: purchaseOrders.length === 1 ? purchaseOrders[0].id : "", vendor_name: "", purchase_date: "", total_amount: "", reference: "", notes: "" });
  const [uploading, setUploading] = useState(false);
  const { pending, error, run, setError } = useAction();

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const check = checkReceiptFile(f);
      if (!check.ok) { setError(check.error); continue; }
      if (next.length < RECEIPT_MAX_FILES) next.push(f);
    }
    setFiles(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!files.length) { setError("Choose at least one receipt file."); return; }
    setUploading(true);
    const uploaded: { path: string; original_filename: string }[] = [];
    try {
      const supabase = createSupabaseBrowserClient();
      for (const file of files) {
        const check = checkReceiptFile(file);
        if (!check.ok) throw new Error(check.error);
        const path = `requisitions/${requisitionId}/${crypto.randomUUID()}.${check.ext}`;
        const { error: uploadError } = await supabase.storage.from("receipts").upload(path, file, { contentType: check.mime, upsert: false });
        if (uploadError) throw new Error(`Could not upload ${file.name}.`);
        uploaded.push({ path, original_filename: file.name.slice(0, 255) });
      }
    } catch (err) {
      setUploading(false);
      setError((err as Error).message);
      return;
    }
    setUploading(false);
    run(() => registerReceipt(requisitionId, { ...details, purchase_order_id: details.purchase_order_id || null, files: uploaded }), () => {
      setOpen(false);
      setFiles([]);
    });
  }

  const busy = uploading || pending;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Upload className="size-4" aria-hidden /> Upload receipt</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Upload receipt" description="Receipts are stored privately. Uploading does not mark anything purchased — reconcile the receipt afterwards.">
        <form className="space-y-4" onSubmit={submit}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/20 p-5 text-center hover:border-navy/40">
            <Upload className="size-6 text-navy/60" aria-hidden />
            <span className="text-sm font-medium">Take a photo or choose files</span>
            <span className="text-xs text-navy/55">PDF, JPEG, PNG or HEIC · 10 MB max each</span>
            <input type="file" multiple accept={RECEIPT_ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </label>
          {files.length ? (
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-gray px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Paperclip className="size-4 shrink-0" aria-hidden /><span className="truncate">{f.name}</span></span>
                  <button type="button" className="flex size-9 items-center justify-center rounded-lg hover:bg-navy/10" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {purchaseOrders.length ? (
              <Field label="Purchase Order" htmlFor="rc_po">
                <Select id="rc_po" value={details.purchase_order_id} onChange={(e) => setDetails({ ...details, purchase_order_id: e.target.value })}>
                  <option value="">None</option>
                  {purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="Vendor" htmlFor="rc_vendor"><Input id="rc_vendor" value={details.vendor_name} onChange={(e) => setDetails({ ...details, vendor_name: e.target.value })} /></Field>
            <Field label="Purchase date" htmlFor="rc_date"><Input id="rc_date" type="date" value={details.purchase_date} onChange={(e) => setDetails({ ...details, purchase_date: e.target.value })} /></Field>
            <Field label="Receipt total" htmlFor="rc_total"><Input id="rc_total" inputMode="decimal" className="tabular" placeholder="0.00" value={details.total_amount} onChange={(e) => setDetails({ ...details, total_amount: e.target.value })} /></Field>
            <Field label="Receipt / invoice #" htmlFor="rc_ref"><Input id="rc_ref" value={details.reference} onChange={(e) => setDetails({ ...details, reference: e.target.value })} /></Field>
          </div>
          <Field label="Notes" htmlFor="rc_notes"><Textarea id="rc_notes" rows={2} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !files.length}>{busy ? <Spinner /> : null}{uploading ? "Uploading…" : pending ? "Saving…" : "Upload receipt"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
