import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, FileText, Paperclip } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import { listReviewers, loadRequisitionDetail } from "@/lib/data/requisition-detail";
import { getChurchSettings } from "@/lib/data/settings";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, numericToCents, formatCents, quantityToDecimal } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PURCHASING_STATUSES, REVIEWABLE_STATUSES, STATUS_LABELS } from "@/lib/workflow/status";
import { timelineFor, timelineStates } from "@/lib/workflow/request-types";
import { countByPriority, isPriority, PRIORITY_LABELS } from "@/lib/priority";
import { PriorityEditor } from "./priority-editor";
import { Timeline } from "./timeline";
import { ReviewDialog } from "./review-dialog";
import { PurchaseOrderDialog } from "./purchase-order-dialog";
import { VendorOrderDialog } from "./vendor-order-dialog";
import { ReceiptUploadDialog } from "./receipt-upload-dialog";
import { ReconcileDialog } from "./reconcile-dialog";
import { DisbursementDialog } from "./disbursement-dialog";
import {
  AssignReviewer, CancelOrderButton, CancelRemainingButton, CloseRequisitionButton, CommentForm, RegeneratePdfButton,
  RejectReceiptButton, StartReviewButton, VoidPoButton,
} from "./simple-actions";

export const metadata = { title: "Requisition" };

const ACTION_LABELS: Record<string, string> = {
  "requisition.submitted": "Requisition submitted",
  "requisition.status_changed": "Status changed",
  "requisition.approved": "Approved",
  "requisition.partially_approved": "Partially approved",
  "requisition.rejected": "Rejected",
  "requisition.held": "Placed on hold",
  "requisition.reviewer_assigned": "Reviewer assigned",
  "requisition.closed": "Closed",
  "requisition.purchase_completed": "Purchase completed",
  "purchase_order.issued": "Purchase Order issued",
  "purchase_order.pdf_generated": "PO PDF generated",
  "purchase_order.voided": "Purchase Order voided",
  "vendor_order.recorded": "Vendor order recorded",
  "vendor_order.cancelled": "Vendor order cancelled",
  "receipt.uploaded": "Receipt uploaded",
  "receipt.received_by_email": "Receipt received by email",
  "receipt.assigned": "Receipt assigned",
  "receipt.reconciled": "Receipt reconciled",
  "receipt.rejected": "Receipt rejected",
  "requisition_item.remaining_cancelled": "Remaining quantity cancelled",
  "disbursement.recorded": "Disbursement recorded",
  "requisition_item.priority_changed": "Item priority changed",
};

/** Extra line for audit entries whose metadata explains the change. */
function auditDetail(action: string, metadata: Record<string, unknown>): string | null {
  if (action === "requisition_item.priority_changed") {
    const from = isPriority(metadata.from) ? PRIORITY_LABELS[metadata.from] : String(metadata.from ?? "—");
    const to = isPriority(metadata.to) ? PRIORITY_LABELS[metadata.to] : String(metadata.to ?? "—");
    if (from === to) return `Line ${metadata.line_number ?? "?"}: Essential explanation updated`;
    return `Line ${metadata.line_number ?? "?"}${metadata.description ? ` (${metadata.description})` : ""}: ${from} → ${to}`;
  }
  return null;
}

function q(value: string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return String(value).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export default async function RequisitionDetailPage({ params }: PageProps<"/requisitions/[id]">) {
  const user = await requirePagePermission("requisitions.view");
  const { id } = await params;
  const detail = await loadRequisitionDetail(id);
  if (!detail) notFound();
  const settings = await getChurchSettings();
  const currency = settings?.currency_code ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const can = (p: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(p);
  const d = detail;
  const name = (uid: string | null) => (uid ? d.people.get(uid) ?? "Unknown user" : null);

  const reviewable = REVIEWABLE_STATUSES.includes(d.status);
  const purchasing = PURCHASING_STATUSES.includes(d.status);
  const closedOrRejected = d.status === "closed" || d.status === "rejected";
  const [reviewers, costCenters, expenseCats] = await Promise.all([
    can("requisitions.review") ? listReviewers() : Promise.resolve([]),
    can("requisitions.review") ? (await createSupabaseServerClient()).from("cost_centers").select("id, code, name").eq("is_active", true).order("sort_order") : Promise.resolve({ data: [] }),
    can("requisitions.review") ? listCategories("requisition") : Promise.resolve([]),
  ]);

  const steps = timelineFor(d.requestType);
  const states = timelineStates(steps, {
    status: d.status,
    reachedStatuses: new Set([...d.history.map((h) => h.to_status), d.status]),
    hasReceipt: d.receipts.some((r) => r.status !== "rejected"),
    hasDisbursement: d.disbursements.length > 0,
  });

  const approvedItems = d.items.filter((i) => i.review_status === "approved");
  const activePos = d.purchaseOrders.filter((p) => p.status === "issued");
  const pendingReceipts = d.receipts.filter((r) => r.status === "pending");
  const variance = numericToCents(d.actual_total) - numericToCents(d.approved_total);

  const itemModels = d.items.map((i) => ({
    id: i.id,
    line: i.line_number,
    description: i.description,
    quantity: i.quantity,
    estimatedUnitPrice: i.estimated_unit_price,
    reviewStatus: i.review_status,
    approvedQuantity: i.approved_quantity,
    approvedUnitPrice: i.approved_unit_price,
    approvedTotal: i.approved_total,
    poQuantity: i.po_quantity,
    orderedQuantity: i.ordered_quantity,
    purchasedQuantity: i.purchased_quantity,
    cancelledQuantity: i.cancelled_quantity,
    actualTotal: i.actual_total,
    reviewComment: i.review_comment,
    vendorName: i.vendor_name,
    priority: i.priority,
    essentialJustification: i.essential_justification,
  }));
  const priorityCounts = countByPriority(d.items);
  const itemById = new Map(d.items.map((i) => [i.id, i]));
  const canEditPriority = can("requisitions.review") && d.status !== "closed";

  return (
    <>
      <Link href="/requisitions" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy/65 hover:text-navy">
        <ArrowLeft className="size-4" aria-hidden /> Requisitions
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-navy/55">
            {d.requestType.name} · {d.department.name} · {d.subcategory.name}
          </p>
          <h1 className="tabular gold-rule font-serif text-title sm:text-display">{d.requisition_number}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            {d.is_demo ? <Badge>Demo data</Badge> : null}
            <span className="text-sm text-navy/60">Submitted {formatDateTime(d.submitted_at, tz)} · needed {formatDate(d.needed_by, "long")}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("requisitions.review") && (d.status === "submitted" || d.status === "on_hold") ? <StartReviewButton requisitionId={d.id} /> : null}
          {can("requisitions.review") && reviewable ? (
            <ReviewDialog
              key={`rv-${d.status}`}
              requisitionId={d.id}
              items={itemModels}
              currency={currency}
              costCenters={(costCenters.data ?? []) as { id: string; code: string; name: string }[]}
              expenseCategories={expenseCats.filter((c) => c.is_active && !c.parent_id).map((c) => ({ id: c.id, name: c.name }))}
              currentCostCenterId={d.cost_center_id}
              currentExpenseCategoryId={d.expense_category_id}
            />
          ) : null}
          {can("purchase_orders.issue") && d.requestType.issues_purchase_order && purchasing ? (
            <PurchaseOrderDialog key={`po-${d.items.map((i) => i.po_quantity + i.cancelled_quantity).join("|")}`} requisitionId={d.id} items={itemModels} currency={currency} />
          ) : null}
          {can("orders.record") && d.requestType.allows_vendor_orders && purchasing ? (
            <VendorOrderDialog key={`vo-${d.items.map((i) => i.ordered_quantity + i.cancelled_quantity).join("|")}`} requisitionId={d.id} items={itemModels} currency={currency} purchaseOrders={activePos.map((p) => ({ id: p.id, po_number: p.po_number, vendor_name: p.vendor_name }))} />
          ) : null}
          {can("receipts.upload") && !closedOrRejected ? (
            <ReceiptUploadDialog requisitionId={d.id} purchaseOrders={activePos.map((p) => ({ id: p.id, po_number: p.po_number }))} />
          ) : null}
          {can("disbursements.record") && d.requestType.requires_disbursement && (purchasing || d.status === "purchased") ? (
            <DisbursementDialog requisitionId={d.id} remaining={formatCents(numericToCents(d.approved_total) - numericToCents(d.disbursed_total), currency)} workflow={d.requestType.workflow} />
          ) : null}
          {can("requisitions.review") && !reviewable && d.status !== "closed" ? (
            <CloseRequisitionButton requisitionId={d.id} requireComment={!["purchased", "rejected"].includes(d.status)} />
          ) : null}
        </div>
      </header>

      <Card className="mb-6">
        <CardBody className="pt-5">
          <Timeline steps={steps} states={states} />
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {/* Line items */}
          <Card>
            <CardHeader
              title="Line items"
              description={[
                `${d.items.length} item${d.items.length === 1 ? "" : "s"} requested`,
                ...(["essential", "high"] as const).filter((p) => priorityCounts[p]).map((p) => `${priorityCounts[p]} ${PRIORITY_LABELS[p]}`),
              ].join(" · ")}
            />
            <CardBody className="px-0 sm:px-0">
              {priorityCounts.essential ? (
                <div role="note" className="mx-5 mb-3 flex items-start gap-2 rounded-xl border-l-4 border-energy-orange bg-energy-orange/10 px-3 py-2 text-sm sm:mx-6">
                  <PriorityBadge priority="essential" size="sm" />
                  <span>
                    <strong>{priorityCounts.essential === 1 ? "Essential item included." : `${priorityCounts.essential} Essential items included.`}</strong>{" "}
                    The requester&rsquo;s reasons are shown on each line. Priority is information only. You can still approve, hold or reject any item.
                  </span>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-[12px] text-navy/55">
                    <tr className="border-y border-navy/10">
                      <th className="py-2 pl-5 pr-2 font-medium sm:pl-6">#</th>
                      <th className="px-2 py-2 font-medium">Item</th>
                      <th className="px-2 py-2 text-right font-medium">Requested</th>
                      <th className="px-2 py-2 font-medium">Decision</th>
                      <th className="px-2 py-2 text-right font-medium">Approved</th>
                      <th className="px-2 py-2 text-right font-medium">On PO</th>
                      <th className="px-2 py-2 text-right font-medium">Ordered</th>
                      <th className="px-2 py-2 text-right font-medium">Purchased</th>
                      <th className="px-2 py-2 pr-5 text-right font-medium sm:pr-6">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/[0.07] align-top">
                    {d.items.map((i) => {
                      const remaining = i.review_status === "approved"
                        ? numericToCents(i.approved_quantity) - numericToCents(i.purchased_quantity) - numericToCents(i.cancelled_quantity)
                        : 0n;
                      return (
                        <tr key={i.id}>
                          <td className="tabular py-3 pl-5 pr-2 text-navy/50 sm:pl-6">{i.line_number}</td>
                          <td className="px-2 py-3">
                            <div className="mb-1 flex flex-wrap items-center gap-1">
                              <PriorityBadge priority={i.priority} size="sm" />
                              {canEditPriority ? (
                                <PriorityEditor requisitionId={d.id} item={{ id: i.id, line: i.line_number, description: i.description, priority: i.priority, essentialJustification: i.essential_justification }} />
                              ) : null}
                            </div>
                            <p className="font-medium">{i.description}</p>
                            {i.essential_justification ? (
                              <p className="mt-1 rounded-lg bg-energy-orange/10 px-2 py-1 text-[13px]"><span className="font-bold">Why essential:</span> {i.essential_justification}</p>
                            ) : null}
                            <p className="text-[13px] text-navy/60">
                              {[i.specifications, i.color && `Color: ${i.color}`, i.size && `Size: ${i.size}`, i.vendor_name && `Vendor: ${i.vendor_name}`].filter(Boolean).join(" · ")}
                            </p>
                            {i.vendor_url ? (
                              <a href={i.vendor_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-ministry-blue underline-offset-2 hover:underline">
                                Product link <ExternalLink className="size-3" aria-hidden />
                              </a>
                            ) : null}
                            {i.notes ? <p className="mt-1 text-[13px] text-navy/60">Note: {i.notes}</p> : null}
                            {i.review_comment ? <p className="mt-1 text-[13px] font-medium">Finance: {i.review_comment}</p> : null}
                            {Number(i.cancelled_quantity) > 0 ? <p className="mt-1 text-[13px] text-navy/60">{q(i.cancelled_quantity)} not purchased — {i.cancel_reason}</p> : null}
                          </td>
                          <td className="tabular px-2 py-3 text-right">
                            {q(i.quantity)} × {formatMoney(i.estimated_unit_price, currency)}
                            <span className="block font-medium">{formatMoney(i.estimated_total, currency)}</span>
                          </td>
                          <td className="px-2 py-3">
                            <Badge tone={i.review_status === "approved" ? "positive" : i.review_status === "rejected" ? "negative" : i.review_status === "held" ? "attention" : "neutral"}>
                              {i.review_status === "pending" ? "Pending" : i.review_status.charAt(0).toUpperCase() + i.review_status.slice(1)}
                            </Badge>
                          </td>
                          <td className="tabular px-2 py-3 text-right">
                            {i.review_status === "approved" ? (
                              <>
                                {q(i.approved_quantity)} × {formatMoney(i.approved_unit_price, currency)}
                                <span className="block font-medium">{formatMoney(i.approved_total, currency)}</span>
                              </>
                            ) : "—"}
                          </td>
                          <td className="tabular px-2 py-3 text-right">{i.review_status === "approved" ? q(i.po_quantity) : "—"}</td>
                          <td className="tabular px-2 py-3 text-right">{i.review_status === "approved" ? q(i.ordered_quantity) : "—"}</td>
                          <td className="tabular px-2 py-3 text-right">
                            {i.review_status === "approved" ? q(i.purchased_quantity) : "—"}
                            {remaining > 0n ? <span className="block text-[12px] text-navy/55">{quantityToDecimal(remaining)} remaining</span> : null}
                            {remaining > 0n && can("receipts.reconcile") && purchasing ? (
                              <CancelRemainingButton requisitionId={d.id} itemId={i.id} max={quantityToDecimal(remaining)} />
                            ) : null}
                          </td>
                          <td className="tabular px-2 py-3 pr-5 text-right font-medium sm:pr-6">{i.review_status === "approved" ? formatMoney(i.actual_total, currency) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* Justification */}
          <Card>
            <CardHeader title="Purpose / ministry justification" />
            <CardBody>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{d.justification}</p>
              <p className="mt-4 rounded-xl bg-neutral-gray px-3 py-2 text-[13px] text-navy/70">
                Certified by <strong>{d.certification_name}</strong> on {formatDateTime(d.certified_at, tz)}: the information is accurate and the purchase is for authorized church/ministry purposes.
              </p>
            </CardBody>
          </Card>

          {/* Purchase orders */}
          {d.requestType.issues_purchase_order || d.purchaseOrders.length ? (
            <Card>
              <CardHeader title="Purchase Orders" description={d.purchaseOrders.length ? undefined : "No Purchase Order has been issued yet."} />
              {d.purchaseOrders.length ? (
                <CardBody className="space-y-3">
                  {d.purchaseOrders.map((po) => (
                    <div key={po.id} className="rounded-2xl border border-navy/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <FileText className="size-5 text-navy/60" aria-hidden />
                          <span className="tabular font-bold">{po.po_number}</span>
                          {po.status === "void" ? <Badge tone="negative">Void</Badge> : <Badge tone="info">Issued</Badge>}
                        </div>
                        <span className="tabular font-bold">{formatMoney(po.total, currency)}</span>
                      </div>
                      <p className="mt-1 text-sm text-navy/60">
                        {po.vendor_name ?? "Vendor per line"} · issued {formatDateTime(po.issued_at, tz)} by {name(po.issued_by) ?? "—"}
                        {po.void_reason ? ` · voided: ${po.void_reason}` : ""}
                      </p>
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {po.purchase_order_items.map((li) => {
                          const item = itemById.get(li.requisition_item_id);
                          return (
                            <li key={li.id} className="flex justify-between gap-4">
                              <span className="flex min-w-0 items-center gap-2">{item ? <PriorityBadge priority={item.priority} size="sm" /> : null}<span>{li.description} × {q(li.quantity)}</span></span>
                              <span className="tabular">{formatMoney(li.line_total, currency)}</span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {po.pdf_path ? (
                          <a href={`/purchase-orders/${po.id}/pdf`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-navy px-3 text-sm font-medium text-gold">
                            <Download className="size-4" aria-hidden /> Download PDF
                          </a>
                        ) : null}
                        {can("purchase_orders.issue") ? <RegeneratePdfButton purchaseOrderId={po.id} hasPdf={Boolean(po.pdf_path)} /> : null}
                        {can("purchase_orders.issue") && po.status === "issued" ? <VoidPoButton requisitionId={d.id} purchaseOrderId={po.id} /> : null}
                      </div>
                    </div>
                  ))}
                </CardBody>
              ) : <div className="pb-5" />}
            </Card>
          ) : null}

          {/* Vendor orders */}
          {d.requestType.allows_vendor_orders || d.vendorOrders.length ? (
            <Card>
              <CardHeader title="Vendor orders" description={d.vendorOrders.length ? undefined : "No orders recorded yet."} />
              {d.vendorOrders.length ? (
                <CardBody className="space-y-3">
                  {d.vendorOrders.map((o) => (
                    <div key={o.id} className="rounded-2xl border border-navy/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">{o.vendor_name}{o.vendor_reference ? <span className="ml-2 font-normal text-navy/60">Ref {o.vendor_reference}</span> : null}</span>
                        <span className="flex items-center gap-2">
                          {o.status === "cancelled" ? <Badge tone="negative">Cancelled</Badge> : null}
                          <span className="tabular font-bold">{formatMoney(o.total, currency)}</span>
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-navy/60">
                        Ordered {formatDate(o.order_date)}{o.expected_delivery_date ? ` · expected ${formatDate(o.expected_delivery_date)}` : ""} · recorded by {name(o.created_by) ?? "—"}
                        {o.cancel_reason ? ` · cancelled: ${o.cancel_reason}` : ""}
                      </p>
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {o.vendor_order_items.map((li) => {
                          const item = itemById.get(li.requisition_item_id);
                          return (
                            <li key={li.requisition_item_id} className="flex justify-between gap-4">
                              <span className="flex min-w-0 items-center gap-2">{item ? <PriorityBadge priority={item.priority} size="sm" /> : null}<span>{item?.description} × {q(li.quantity)}</span></span>
                              <span className="tabular">{formatMoney(li.line_total, currency)}</span>
                            </li>
                          );
                        })}
                      </ul>
                      {o.notes ? <p className="mt-2 text-sm text-navy/70">{o.notes}</p> : null}
                      {can("orders.record") && o.status === "placed" && purchasing ? <div className="mt-3"><CancelOrderButton requisitionId={d.id} orderId={o.id} /></div> : null}
                    </div>
                  ))}
                </CardBody>
              ) : <div className="pb-5" />}
            </Card>
          ) : null}

          {/* Receipts */}
          <Card id="receipts">
            <CardHeader
              title="Receipts & reconciliation"
              description={pendingReceipts.length ? `${pendingReceipts.length} receipt${pendingReceipts.length === 1 ? "" : "s"} waiting for reconciliation. Nothing is marked purchased until a receipt is reconciled.` : d.receipts.length ? undefined : "No receipts yet."}
            />
            {d.receipts.length ? (
              <CardBody className="space-y-3">
                {d.receipts.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-navy/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.status === "reconciled" ? "positive" : r.status === "rejected" ? "negative" : "attention"}>
                          {r.status === "pending" ? "Awaiting reconciliation" : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </Badge>
                        <span className="text-sm text-navy/60">
                          {r.source === "email" ? "Emailed" : r.source === "submission" ? "Submitted with request" : "Uploaded"} {formatDateTime(r.created_at, tz)}
                          {r.uploaded_by ? ` by ${name(r.uploaded_by)}` : r.submitted_by_label ? ` by ${r.submitted_by_label.replace(/^(external|email):/, "")}` : ""}
                        </span>
                      </div>
                      {r.total_amount ? <span className="tabular font-bold">{formatMoney(r.total_amount, currency)}</span> : null}
                    </div>
                    {[r.vendor_name, r.purchase_date && formatDate(r.purchase_date), r.reference && `Ref ${r.reference}`].filter(Boolean).length ? (
                      <p className="mt-1 text-sm text-navy/70">{[r.vendor_name, r.purchase_date && formatDate(r.purchase_date), r.reference && `Ref ${r.reference}`].filter(Boolean).join(" · ")}</p>
                    ) : null}
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {r.receipt_files.map((f) => (
                        <li key={f.id}>
                          <a href={`/files/receipts/${f.id}`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-neutral-gray px-3 text-sm hover:bg-navy/10">
                            <Paperclip className="size-4" aria-hidden /> {f.original_filename}
                          </a>
                        </li>
                      ))}
                    </ul>
                    {r.receipt_item_allocations.length ? (
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {r.receipt_item_allocations.map((a) => {
                          const item = itemById.get(a.requisition_item_id);
                          return (
                            <li key={a.requisition_item_id} className="flex justify-between gap-4">
                              <span className="flex min-w-0 items-center gap-2">{item ? <PriorityBadge priority={item.priority} size="sm" /> : null}<span>{item?.description} × {q(a.quantity)}</span></span>
                              <span className="tabular">{formatMoney(a.actual_amount, currency)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {r.notes ? <p className="mt-2 text-[13px] text-navy/60">{r.notes}</p> : null}
                    {r.reconciliation_notes ? <p className="mt-1 text-[13px] text-navy/70">Reconciliation: {r.reconciliation_notes}</p> : null}
                    {r.rejected_reason ? <p className="mt-1 text-[13px]">Rejected: {r.rejected_reason}</p> : null}
                    {r.status === "pending" && can("receipts.reconcile") ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {purchasing || d.status === "purchased" ? (
                          <ReconcileDialog
                            key={`rc-${r.id}-${d.items.map((i) => i.purchased_quantity).join("|")}`}
                            requisitionId={d.id}
                            receipt={{ id: r.id, vendor_name: r.vendor_name, purchase_date: r.purchase_date, total_amount: r.total_amount, reference: r.reference, purchase_order_id: r.purchase_order_id }}
                            items={itemModels.filter((x) => x.reviewStatus === "approved")}
                            purchaseOrderItems={activePos.flatMap((p) => p.purchase_order_items.map((li) => ({ id: li.id, requisitionItemId: li.requisition_item_id, poNumber: p.po_number, poId: p.id })))}
                            currency={currency}
                          />
                        ) : (
                          <p className="text-sm text-navy/60">Review and approve the requisition before reconciling.</p>
                        )}
                        <RejectReceiptButton requisitionId={d.id} receiptId={r.id} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardBody>
            ) : <div className="pb-5" />}
          </Card>

          {/* Disbursements */}
          {d.requestType.requires_disbursement || d.disbursements.length ? (
            <Card>
              <CardHeader title={d.requestType.workflow === "reimbursement" ? "Reimbursement payments" : "Disbursements"} description={d.disbursements.length ? undefined : "No funds disbursed yet."} />
              {d.disbursements.length ? (
                <CardBody>
                  <ul className="divide-y divide-navy/10 text-sm">
                    {d.disbursements.map((x) => (
                      <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                        <span>{formatDate(x.paid_on)} · {x.method.replace("_", " ")}{x.reference ? ` #${x.reference}` : ""} · {name(x.recorded_by)}</span>
                        <span className="tabular font-bold">{formatMoney(x.amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              ) : <div className="pb-5" />}
            </Card>
          ) : null}

          {/* Comments */}
          <Card>
            <CardHeader title="Internal comments" description="Visible to staff only." />
            <CardBody className="space-y-4">
              {d.comments.length ? (
                <ul className="space-y-3">
                  {d.comments.map((c) => (
                    <li key={c.id} className="rounded-2xl bg-neutral-gray px-4 py-3">
                      <p className="text-[13px] text-navy/60">{name(c.author_id)} · {formatDateTime(c.created_at, tz)}</p>
                      <p className="mt-1 whitespace-pre-wrap text-[15px]">{c.body}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <CommentForm requisitionId={d.id} />
            </CardBody>
          </Card>
        </div>

        {/* Side column */}
        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Totals" />
            <CardBody>
              <dl className="space-y-2 text-[15px]">
                <Row label="Estimated" value={formatMoney(d.estimated_total, currency)} />
                <Row label="Approved" value={formatMoney(d.approved_total, currency)} />
                <Row label="Actual (reconciled)" value={formatMoney(d.actual_total, currency)} />
                {d.requestType.requires_disbursement ? <Row label="Disbursed" value={formatMoney(d.disbursed_total, currency)} /> : null}
                {approvedItems.length && numericToCents(d.actual_total) > 0n ? (
                  <Row label="Variance vs approved" value={`${variance > 0n ? "+" : ""}${formatCents(variance, currency)}`} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Requester" />
            <CardBody>
              <dl className="space-y-2 text-[15px]">
                <Row label="Name" value={d.requester_name} />
                <Row label="Email" value={<a className="underline decoration-gold underline-offset-4" href={`mailto:${d.requester_email}`}>{d.requester_email}</a>} />
                <Row label="Phone" value={<a className="underline decoration-gold underline-offset-4" href={`tel:${d.requester_phone.replace(/[^\d+]/g, "")}`}>{d.requester_phone}</a>} />
                <Row label="Department head" value={d.department_head_name} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Financial coding" />
            <CardBody>
              <dl className="space-y-2 text-[15px]">
                <Row label="Budget line" value={d.costCenter ? `${d.costCenter.code} — ${d.costCenter.name}` : "Not specified"} />
                <Row label="Within budget?" value={d.budget_status === "yes" ? "Yes" : d.budget_status === "no" ? "No" : "Unsure"} />
                {d.budget_explanation ? <p className="rounded-xl bg-neutral-gray px-3 py-2 text-sm">{d.budget_explanation}</p> : null}
                <Row label="Expense category" value={d.expenseCategory?.name ?? "Not assigned"} />
              </dl>
            </CardBody>
          </Card>

          {d.requestType.requires_purchase_details ? (
            <Card>
              <CardHeader title="Purchase already made" />
              <CardBody>
                <dl className="space-y-2 text-[15px]">
                  <Row label="Amount paid" value={formatMoney(d.actual_purchase_amount, currency)} />
                  <Row label="Vendor" value={d.purchase_vendor ?? "—"} />
                  <Row label="Purchase date" value={formatDate(d.purchase_date)} />
                </dl>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Review" />
            <CardBody className="space-y-3">
              <dl className="space-y-2 text-[15px]">
                <Row label="Reviewed by" value={name(d.reviewed_by) ?? "—"} />
                <Row label="Reviewed" value={d.reviewed_at ? formatDateTime(d.reviewed_at, tz) : "—"} />
              </dl>
              {d.review_comment ? <p className="rounded-xl bg-neutral-gray px-3 py-2 text-sm">{d.review_comment}</p> : null}
              {can("requisitions.review") ? (
                <AssignReviewer requisitionId={d.id} reviewers={reviewers} current={d.assigned_reviewer_id} />
              ) : (
                <Row label="Assigned reviewer" value={name(d.assigned_reviewer_id) ?? "Unassigned"} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status history" />
            <CardBody>
              <ol className="space-y-3 border-l-2 border-gold/60 pl-4">
                {d.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <p className="font-medium">{h.from_status ? `${STATUS_LABELS[h.from_status]} → ` : ""}{STATUS_LABELS[h.to_status]}</p>
                    <p className="text-[13px] text-navy/60">{formatDateTime(h.created_at, tz)} · {name(h.changed_by) ?? h.changed_by_label?.replace(/^(external|system|email):/, "") ?? "System"}</p>
                    {h.comment ? <p className="mt-0.5 text-[13px] text-navy/75">{h.comment}</p> : null}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <details>
              <summary className="cursor-pointer list-none px-5 py-5 sm:px-6">
                <span className="text-[17px] font-bold">Audit history</span>
                <span className="ml-2 text-sm text-navy/55">{d.audit.length} events · tap to expand</span>
              </summary>
              <CardBody className="pt-0">
                <ul className="space-y-2 text-sm">
                  {d.audit.map((a) => (
                    <li key={a.id} className="border-b border-navy/5 pb-2 last:border-0">
                      <p className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</p>
                      {auditDetail(a.action, a.metadata ?? {}) ? <p className="text-[13px] text-navy/80">{auditDetail(a.action, a.metadata ?? {})}</p> : null}
                      <p className="text-[13px] text-navy/60">{formatDateTime(a.occurred_at, tz)} · {name(a.actor_id) ?? a.actor_label ?? "System"}</p>
                    </li>
                  ))}
                </ul>
                {d.notifications.length ? (
                  <>
                    <p className="mb-2 mt-5 text-sm font-bold">Notifications</p>
                    <ul className="space-y-1 text-[13px] text-navy/70">
                      {d.notifications.map((n) => (
                        <li key={n.id}>{formatDateTime(n.created_at, tz)} · {n.channel} · {n.template.replace(/_/g, " ")} · <span className="font-medium">{n.status}</span>{n.error ? ` (${n.error})` : ""}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </CardBody>
            </details>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-navy/60">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}

