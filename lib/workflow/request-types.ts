import type { RequisitionStatus } from "./status";

export type WorkflowKind = "church_order" | "purchase_order" | "reimbursement" | "petty_cash" | "advance_check";

export const WORKFLOW_LABELS: Record<WorkflowKind, string> = {
  church_order: "Order — Finance purchases for the department",
  purchase_order: "Direct Purchase — requester buys with a church PO",
  reimbursement: "Reimbursement — repay an eligible purchase",
  petty_cash: "Petty Cash — small cash disbursement",
  advance_check: "Advance Check — funds issued before the expense",
};

export interface RequestTypeRules {
  workflow: WorkflowKind;
  issues_purchase_order: boolean;
  allows_vendor_orders: boolean;
  requires_disbursement: boolean;
  requires_receipt_on_submission: boolean;
  requires_purchase_details: boolean;
}

export type TimelineStep = { key: string; label: string };

/** The happy-path timeline shown on the requisition detail page, per workflow. */
export function timelineFor(rules: RequestTypeRules): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "submitted", label: "Submitted" },
    { key: "under_review", label: "Under Review" },
    { key: "approved", label: "Approved" },
  ];
  if (rules.issues_purchase_order) steps.push({ key: "po_issued", label: "PO Issued" });
  if (rules.allows_vendor_orders) steps.push({ key: "ordered", label: "Ordered" });
  if (rules.requires_disbursement && rules.workflow !== "reimbursement") {
    steps.push({ key: "disbursed", label: rules.workflow === "advance_check" ? "Check Issued" : "Cash Disbursed" });
  }
  steps.push({ key: "receipt_received", label: "Receipt Received" });
  steps.push({ key: "purchased", label: "Purchased" });
  if (rules.workflow === "reimbursement") steps.push({ key: "disbursed", label: "Reimbursed" });
  steps.push({ key: "closed", label: "Closed" });
  return steps;
}

export interface TimelineFacts {
  status: RequisitionStatus;
  reachedStatuses: ReadonlySet<string>;
  hasReceipt: boolean;
  hasDisbursement: boolean;
}

export type StepState = "done" | "current" | "upcoming" | "stopped";

/** Decide the state of every step from what has actually happened. */
export function timelineStates(steps: TimelineStep[], facts: TimelineFacts): StepState[] {
  const done = (key: string): boolean => {
    switch (key) {
      case "receipt_received":
        return facts.hasReceipt;
      case "disbursed":
        return facts.hasDisbursement;
      case "approved":
        return facts.reachedStatuses.has("approved") || facts.reachedStatuses.has("partially_approved");
      case "purchased":
        return facts.reachedStatuses.has("purchased");
      default:
        return facts.reachedStatuses.has(key);
    }
  };
  if (facts.status === "rejected") {
    return steps.map((s) => (done(s.key) ? "done" : s.key === "approved" ? "stopped" : "upcoming"));
  }
  let currentAssigned = false;
  return steps.map((s) => {
    if (done(s.key)) return "done";
    if (!currentAssigned) {
      currentAssigned = true;
      return "current";
    }
    return "upcoming";
  });
}
