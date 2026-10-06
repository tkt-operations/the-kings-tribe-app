import { numericToCents, type Cents } from "./money";

export interface RequisitionReportRow {
  id: string;
  requisition_number: string;
  submitted_at: string;
  status: string;
  estimated_total: string;
  approved_total: string;
  actual_total: string;
  department: string;
  subcategory: string;
  request_type: string;
  expense_category: string | null;
}

export interface Bucket {
  key: string;
  count: number;
  requested: Cents;
  approved: Cents;
  actual: Cents;
}

const OPEN = new Set(["submitted", "under_review", "on_hold", "approved", "partially_approved", "po_issued", "ordered", "partially_purchased", "purchased"]);
const AWAITING_RECEIPTS = new Set(["approved", "partially_approved", "po_issued", "ordered", "partially_purchased"]);
const APPROVED_FAMILY = new Set(["approved", "partially_approved", "po_issued", "ordered", "partially_purchased", "purchased"]);
const COMPLETED = new Set(["purchased"]);

function group(rows: RequisitionReportRow[], keyOf: (r: RequisitionReportRow) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const key = keyOf(r);
    const b = map.get(key) ?? { key, count: 0, requested: 0n, approved: 0n, actual: 0n };
    b.count += 1;
    b.requested += numericToCents(r.estimated_total);
    b.approved += numericToCents(r.approved_total);
    b.actual += numericToCents(r.actual_total);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => (b.requested === a.requested ? a.key.localeCompare(b.key) : b.requested > a.requested ? 1 : -1));
}

export function summarizeRequisitions(rows: RequisitionReportRow[]) {
  const totals = group(rows, () => "All")[0] ?? { key: "All", count: 0, requested: 0n, approved: 0n, actual: 0n };
  const purchasedRows = rows.filter((r) => COMPLETED.has(r.status) || (r.status === "closed" && numericToCents(r.actual_total) > 0n));
  let estimatedOfCompleted = 0n;
  let approvedOfCompleted = 0n;
  let actualOfCompleted = 0n;
  for (const r of purchasedRows) {
    estimatedOfCompleted += numericToCents(r.estimated_total);
    approvedOfCompleted += numericToCents(r.approved_total);
    actualOfCompleted += numericToCents(r.actual_total);
  }
  return {
    totals,
    byDepartment: group(rows, (r) => r.department),
    bySubcategory: group(rows, (r) => `${r.department} · ${r.subcategory}`),
    byRequestType: group(rows, (r) => r.request_type),
    byExpenseCategory: group(rows.filter((r) => numericToCents(r.actual_total) > 0n || numericToCents(r.approved_total) > 0n), (r) => r.expense_category ?? "Unassigned"),
    byStatus: group(rows, (r) => r.status),
    approvedCount: rows.filter((r) => APPROVED_FAMILY.has(r.status) || (r.status === "closed" && numericToCents(r.approved_total) > 0n)).length,
    rejectedCount: rows.filter((r) => r.status === "rejected").length,
    openCount: rows.filter((r) => OPEN.has(r.status)).length,
    awaitingReceipts: rows.filter((r) => AWAITING_RECEIPTS.has(r.status)),
    awaitingPurchase: rows.filter((r) => r.status === "ordered" || r.status === "po_issued"),
    completed: { count: purchasedRows.length, estimated: estimatedOfCompleted, approved: approvedOfCompleted, actual: actualOfCompleted, variance: actualOfCompleted - approvedOfCompleted },
  };
}
