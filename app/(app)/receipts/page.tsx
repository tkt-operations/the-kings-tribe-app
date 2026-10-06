import Link from "next/link";
import { Mail, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UnmatchedActions } from "./unmatched-actions";

export const metadata = { title: "Receipts" };

type ReceiptRow = {
  id: string; status: string; source: string; total_amount: string | null; vendor_name: string | null; created_at: string; notes: string | null; submitted_by_label: string | null;
  receipt_files: { id: string; original_filename: string }[];
  requisitions: { id: string; requisition_number: string; requester_name: string; departments: { name: string } | null } | null;
};

export default async function ReceiptsPage() {
  const user = await requirePagePermission(["receipts.reconcile", "receipts.upload"]);
  const settings = await getChurchSettings();
  const tz = settings?.timezone ?? "UTC";
  const currency = settings?.currency_code ?? "USD";
  const supabase = await createSupabaseServerClient();
  const select = "id, status, source, total_amount, vendor_name, created_at, notes, submitted_by_label, receipt_files(id, original_filename), requisitions(id, requisition_number, requester_name, departments(name))";
  const [{ data: pending }, { data: unmatched }, { data: emails }] = await Promise.all([
    supabase.from("receipts").select(select).eq("status", "pending").order("created_at"),
    user.permissions.has("receipts.reconcile") ? supabase.from("receipts").select(select).eq("status", "unmatched").order("created_at") : Promise.resolve({ data: [] }),
    user.permissions.has("receipts.reconcile")
      ? supabase.from("inbound_emails").select("id, from_address, subject, status, match_method, attachment_count, received_at, error").order("received_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const pendingRows = (pending ?? []) as unknown as ReceiptRow[];
  const unmatchedRows = (unmatched ?? []) as unknown as ReceiptRow[];
  type EmailRow = { id: string; from_address: string | null; subject: string | null; status: string; match_method: string | null; attachment_count: number; received_at: string; error: string | null };

  return (
    <>
      <PageHeader eyebrow="Purchasing" title="Receipts" description="Receipts arrive by upload or by email reply. A receipt never marks items purchased until Finance reconciles it against the approved lines." />

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-section">Waiting for reconciliation</h2>
        {pendingRows.length === 0 ? (
          <EmptyState title="All caught up">No receipts are waiting for reconciliation.</EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pendingRows.map((r) => <ReceiptCard key={r.id} r={r} tz={tz} currency={currency} />)}
          </ul>
        )}
      </section>

      {user.permissions.has("receipts.reconcile") ? (
        <>
          <section className="mb-8">
            <h2 className="mb-3 font-serif text-section">Unmatched email receipts</h2>
            {unmatchedRows.length === 0 ? (
              <p className="text-sm text-navy/60">None. Emailed receipts are matched automatically using the reply address on Purchase Order and status emails.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {unmatchedRows.map((r) => (
                  <ReceiptCard key={r.id} r={r} tz={tz} currency={currency}><UnmatchedActions receiptId={r.id} /></ReceiptCard>
                ))}
              </ul>
            )}
          </section>
          <Card>
            <CardHeader title="Recent inbound emails" description="Processing log for the receipt mailbox." />
            <CardBody>
              {(emails ?? []).length === 0 ? (
                <p className="text-sm text-navy/60">No inbound emails have been received yet.</p>
              ) : (
                <ul className="divide-y divide-navy/10 text-sm">
                  {((emails ?? []) as EmailRow[]).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 font-medium"><Mail className="size-4 text-navy/50" aria-hidden />{e.subject || "(no subject)"}</span>
                        <span className="text-navy/60">{e.from_address} · {formatDateTime(e.received_at, tz)} · {e.attachment_count} attachment{e.attachment_count === 1 ? "" : "s"}{e.match_method ? ` · matched by ${e.match_method}` : ""}{e.error ? ` · ${e.error}` : ""}</span>
                      </span>
                      <Badge tone={e.status === "matched" ? "positive" : e.status === "unmatched" ? "attention" : e.status === "error" ? "negative" : "neutral"}>{e.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}
    </>
  );
}

function ReceiptCard({ r, tz, currency, children }: { r: ReceiptRow; tz: string; currency: string; children?: React.ReactNode }) {
  return (
    <li className="rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {r.requisitions ? (
            <Link href={`/requisitions/${r.requisitions.id}#receipts`} className="tabular font-bold underline decoration-gold decoration-2 underline-offset-4">{r.requisitions.requisition_number}</Link>
          ) : <p className="font-bold">Unassigned</p>}
          <p className="text-sm text-navy/60">
            {r.requisitions ? `${r.requisitions.departments?.name} · ${r.requisitions.requester_name} · ` : ""}
            {r.source === "email" ? "Emailed" : r.source === "submission" ? "With request" : "Uploaded"} {formatDateTime(r.created_at, tz)}
          </p>
          {r.submitted_by_label ? <p className="text-[13px] text-navy/55">{r.submitted_by_label.replace(/^(email|external):/, "From ")}</p> : null}
        </div>
        {r.total_amount ? <span className="tabular font-bold">{formatMoney(r.total_amount, currency)}</span> : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {r.receipt_files.map((f) => (
          <li key={f.id}><a href={`/files/receipts/${f.id}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-neutral-gray px-3 text-sm"><Paperclip className="size-4" aria-hidden /> {f.original_filename}</a></li>
        ))}
      </ul>
      {r.notes ? <p className="mt-2 text-[13px] text-navy/60">{r.notes}</p> : null}
      {children}
    </li>
  );
}
