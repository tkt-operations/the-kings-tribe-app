/** CSV layouts for requisition exports (pure — unit-tested). */
import { toCsv } from "@/lib/csv";
import { dateInTimezone } from "@/lib/dates";
import { centsToDecimal, numericToCents } from "@/lib/money";
import { PRIORITY_LABELS } from "@/lib/priority";
import type { RequisitionItemReportRow, RequisitionReportRow } from "@/lib/reports";
import { STATUS_LABELS, isRequisitionStatus } from "@/lib/workflow/status";

const statusLabel = (s: string) => (isRequisitionStatus(s) ? STATUS_LABELS[s] : s);
const REVIEW_LABELS: Record<string, string> = { pending: "Pending", approved: "Approved", held: "Held", rejected: "Rejected" };

/** `timezone` is the church timezone: "Submitted" is the calendar date the church saw (YYYY-MM-DD). */
export function requisitionsCsv(rows: RequisitionReportRow[], timezone: string): string {
  return toCsv(
    ["Requisition #", "Submitted", "Department", "Subcategory", "Request type", "Expense category", "Status", "Highest item priority", "Essential items", "Estimated", "Approved", "Actual", "Variance (actual − approved)"],
    rows.map((r) => [
      r.requisition_number, dateInTimezone(r.submitted_at, timezone), r.department, r.subcategory, r.request_type, r.expense_category ?? "",
      statusLabel(r.status),
      r.highest_item_priority ? PRIORITY_LABELS[r.highest_item_priority] : "",
      { number: String(r.essential_item_count ?? 0) },
      { number: r.estimated_total }, { number: r.approved_total }, { number: r.actual_total },
      { number: centsToDecimal(numericToCents(r.actual_total) - numericToCents(r.approved_total)) },
    ]),
  );
}

export function requisitionItemsCsv(rows: RequisitionItemReportRow[], timezone: string): string {
  return toCsv(
    ["Requisition #", "Submitted", "Department", "Requisition status", "Line", "Item", "Line Item Priority", "Essential Justification", "Quantity", "Estimated total", "Review decision", "Approved total", "Actual total"],
    rows.map((r) => [
      r.requisition_number, dateInTimezone(r.submitted_at, timezone), r.department, statusLabel(r.status),
      { number: String(r.line_number) }, r.description, PRIORITY_LABELS[r.priority], r.essential_justification ?? "",
      { number: r.quantity }, { number: r.estimated_total }, REVIEW_LABELS[r.review_status] ?? r.review_status,
      { number: r.approved_total }, { number: r.actual_total },
    ]),
  );
}
