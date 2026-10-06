import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { dateInTimezone, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RequisitionStatus } from "@/lib/workflow/status";

export const metadata = { title: "Purchase Orders" };

type Row = {
  id: string; po_number: string; status: "issued" | "void"; vendor_name: string | null; total: string; issued_at: string; pdf_path: string | null; is_demo: boolean;
  requisitions: { id: string; requisition_number: string; requester_name: string; status: RequisitionStatus; departments: { name: string } | null } | null;
};

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/purchase-orders">) {
  await requirePagePermission("requisitions.view");
  const settings = await getChurchSettings();
  const currency = settings?.currency_code ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const params = await searchParams;
  const status = params.status === "void" ? "void" : params.status === "all" ? "all" : "issued";
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("purchase_orders")
    .select("id, po_number, status, vendor_name, total, issued_at, pdf_path, is_demo, requisitions(id, requisition_number, requester_name, status, departments(name))")
    .order("issued_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader eyebrow="Purchasing" title="Purchase Orders" description="Issued from approved requisitions. PDFs are stored privately and downloaded through short-lived links." />
      <nav className="mb-5 inline-flex gap-1.5 rounded-2xl bg-white p-1 ring-1 ring-navy/10" aria-label="Filter">
        {[["issued", "Issued"], ["void", "Void"], ["all", "All"]].map(([k, label]) => (
          <Link key={k} href={`/purchase-orders?status=${k}`} aria-current={status === k ? "page" : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${status === k ? "bg-navy text-gold" : "text-navy/70 hover:bg-navy/5"}`}>{label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="No Purchase Orders yet">Purchase Orders are issued from an approved requisition’s detail page.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((po) => (
            <li key={po.id} className="flex flex-col rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-navy/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="tabular font-serif text-2xl">{po.po_number}</p>
                  <p className="text-sm text-navy/60">{po.vendor_name ?? "Vendor per line"} · {formatDate(dateInTimezone(po.issued_at, tz))}</p>
                </div>
                {po.status === "void" ? <Badge tone="negative">Void</Badge> : po.is_demo ? <Badge>Demo</Badge> : null}
              </div>
              <p className="tabular mt-4 text-2xl font-bold">{formatMoney(po.total, currency)}</p>
              {po.requisitions ? (
                <p className="mt-1 text-sm">
                  <Link className="font-medium underline decoration-gold decoration-2 underline-offset-4" href={`/requisitions/${po.requisitions.id}`}>{po.requisitions.requisition_number}</Link>
                  <span className="text-navy/60"> · {po.requisitions.departments?.name} · {po.requisitions.requester_name}</span>
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-navy/10 pt-4">
                {po.requisitions ? <StatusBadge status={po.requisitions.status} /> : <span />}
                {po.pdf_path ? (
                  <a href={`/purchase-orders/${po.id}/pdf`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-navy px-3 text-sm font-medium text-gold"><Download className="size-4" aria-hidden /> PDF</a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
