/**
 * Requisition detail progress bar (lib/workflow/request-types.ts timelineStates).
 * Regression: a requisition approved straight from Submitted ("Start review" is
 * optional) showed "Under Review" as the current step after approval.
 */
import { describe, expect, it } from "vitest";
import { timelineFor, timelineStates, type RequestTypeRules, type StepState } from "@/lib/workflow/request-types";
import type { RequisitionStatus } from "@/lib/workflow/status";

const ORDER = { workflow: "order", issues_purchase_order: true, allows_vendor_orders: true, requires_disbursement: false } as unknown as RequestTypeRules;
const ADVANCE = { workflow: "advance_check", issues_purchase_order: false, allows_vendor_orders: false, requires_disbursement: true } as unknown as RequestTypeRules;

function view(rules: RequestTypeRules, path: string[], opts: { receipt?: boolean; disbursement?: boolean } = {}) {
  const steps = timelineFor(rules);
  const status = path[path.length - 1] as RequisitionStatus;
  const states = timelineStates(steps, { status, reachedStatuses: new Set(path), hasReceipt: !!opts.receipt, hasDisbursement: !!opts.disbursement });
  return Object.fromEntries(steps.map((s, i) => [s.key, states[i]])) as Record<string, StepState>;
}
const current = (v: Record<string, StepState>) => Object.entries(v).filter(([, s]) => s === "current").map(([k]) => k);

describe("timelineStates", () => {
  it("keeps Under Review current while a review is genuinely in progress", () => {
    expect(view(ORDER, ["submitted"])).toMatchObject({ submitted: "done", under_review: "current", approved: "upcoming" });
    expect(view(ORDER, ["submitted", "under_review"])).toMatchObject({ under_review: "done", approved: "current" });
    expect(current(view(ORDER, ["submitted", "on_hold"]))).toEqual(["under_review"]);
    expect(current(view(ORDER, ["submitted", "under_review", "on_hold"]))).toEqual(["approved"]);
  });

  it.each([
    ["Approved straight from Submitted", ["submitted", "approved"], {}, "po_issued"],
    ["Partially Approved straight from Submitted", ["submitted", "partially_approved"], {}, "po_issued"],
    ["Approved after Start review", ["submitted", "under_review", "approved"], {}, "po_issued"],
    ["PO Issued", ["submitted", "approved", "po_issued"], {}, "ordered"],
    ["Ordered", ["submitted", "approved", "po_issued", "ordered"], {}, "receipt_received"],
    ["Ordered with a receipt", ["submitted", "approved", "po_issued", "ordered"], { receipt: true }, "purchased"],
    ["Partially Purchased", ["submitted", "approved", "po_issued", "ordered", "partially_purchased"], { receipt: true }, "purchased"],
    ["Purchased", ["submitted", "approved", "po_issued", "ordered", "purchased"], { receipt: true }, "closed"],
  ] as const)("%s: Under Review is done and the next real step is current", (_label, path, opts, next) => {
    const v = view(ORDER, [...path], opts);
    expect(v.under_review).toBe("done");
    expect(v.approved).toBe("done");
    expect(current(v)).toEqual([next]);
  });

  it("Closed: everything done and nothing current", () => {
    const v = view(ORDER, ["submitted", "approved", "po_issued", "ordered", "purchased", "closed"], { receipt: true });
    expect(Object.values(v).every((s) => s === "done")).toBe(true);
    expect(current(view(ORDER, ["submitted", "approved", "closed"]))).toEqual([]);
  });

  it("Rejected: reviewed, stopped at approval, nothing current — also once closed", () => {
    for (const path of [["submitted", "rejected"], ["submitted", "under_review", "rejected"], ["submitted", "rejected", "closed"]]) {
      const v = view(ADVANCE, path);
      expect(v).toMatchObject({ submitted: "done", under_review: "done", approved: "stopped", disbursed: "upcoming" });
      expect(current(v)).toEqual([]);
    }
    expect(view(ADVANCE, ["submitted", "rejected", "closed"]).closed).toBe("done");
  });

  it("Advance Check approved: Check Issued is next", () => {
    expect(current(view(ADVANCE, ["submitted", "approved"]))).toEqual(["disbursed"]);
    expect(current(view(ADVANCE, ["submitted", "approved"], { disbursement: true }))).toEqual(["receipt_received"]);
  });
});
