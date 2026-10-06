export const REQUISITION_STATUSES = [
  "submitted",
  "under_review",
  "on_hold",
  "approved",
  "partially_approved",
  "rejected",
  "po_issued",
  "ordered",
  "partially_purchased",
  "purchased",
  "closed",
] as const;

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const STATUS_LABELS: Record<RequisitionStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  on_hold: "On Hold",
  approved: "Approved",
  partially_approved: "Partially Approved",
  rejected: "Rejected",
  po_issued: "PO Issued",
  ordered: "Ordered",
  partially_purchased: "Partially Purchased",
  purchased: "Purchased",
  closed: "Closed",
};

/**
 * Brand-palette status tones. Text on light backgrounds uses colors that pass
 * contrast (navy, Kingdom Green, Ministry Blue); Energy Orange is only used as
 * a fill/marker with an icon, never as small text on white.
 */
export type StatusTone = "neutral" | "info" | "attention" | "positive" | "negative" | "done";

export const STATUS_TONES: Record<RequisitionStatus, StatusTone> = {
  submitted: "info",
  under_review: "info",
  on_hold: "attention",
  approved: "positive",
  partially_approved: "positive",
  rejected: "negative",
  po_issued: "info",
  ordered: "info",
  partially_purchased: "attention",
  purchased: "positive",
  closed: "done",
};

export function isRequisitionStatus(value: string): value is RequisitionStatus {
  return (REQUISITION_STATUSES as readonly string[]).includes(value);
}

/** Statuses in which purchasing activity (POs, orders, receipts) happens. */
export const PURCHASING_STATUSES: readonly RequisitionStatus[] = [
  "approved", "partially_approved", "po_issued", "ordered", "partially_purchased",
];

export const REVIEWABLE_STATUSES: readonly RequisitionStatus[] = ["submitted", "under_review", "on_hold"];

export const OPEN_STATUSES: readonly RequisitionStatus[] = REQUISITION_STATUSES.filter(
  (s) => s !== "closed" && s !== "rejected",
);

/** Mirror of private.transition_allowed() in the database (the authority). */
const TRANSITIONS: Record<RequisitionStatus, readonly RequisitionStatus[]> = {
  submitted: ["under_review", "on_hold", "approved", "partially_approved", "rejected"],
  under_review: ["on_hold", "approved", "partially_approved", "rejected"],
  on_hold: ["under_review", "approved", "partially_approved", "rejected"],
  approved: ["po_issued", "ordered", "partially_purchased", "purchased", "closed"],
  partially_approved: ["po_issued", "ordered", "partially_purchased", "purchased", "closed"],
  po_issued: ["approved", "partially_approved", "ordered", "partially_purchased", "purchased", "closed"],
  ordered: ["approved", "partially_approved", "po_issued", "partially_purchased", "purchased", "closed"],
  partially_purchased: ["purchased", "closed"],
  purchased: ["closed"],
  rejected: ["closed"],
  closed: [],
};

export function canTransition(from: RequisitionStatus, to: RequisitionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
