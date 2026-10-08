// @vitest-environment jsdom
/**
 * Regression for "e.quantity.replace is not a function": lifecycle dialogs fed
 * from API-shaped rows (numeric columns as JS numbers) via the data boundary.
 */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";

vi.mock("server-only", () => ({}));
const calls: Record<string, unknown[]> = {};
const ok = (message: string) => async (...args: unknown[]): Promise<ActionResult> => { calls[message] = args; return { ok: true, data: undefined, message }; };
vi.mock("@/app/(app)/requisitions/[id]/actions", () => ({
  reviewRequisition: (...a: unknown[]) => ok("review")(...a),
  issuePurchaseOrder: (...a: unknown[]) => ok("po")(...a),
  recordVendorOrder: (...a: unknown[]) => ok("order")(...a),
  reconcileReceipt: (...a: unknown[]) => ok("reconcile")(...a),
  updateItemPriority: (...a: unknown[]) => ok("priority")(...a),
}));

const { ReviewDialog } = await import("@/app/(app)/requisitions/[id]/review-dialog");
const { PurchaseOrderDialog } = await import("@/app/(app)/requisitions/[id]/purchase-order-dialog");
const { VendorOrderDialog } = await import("@/app/(app)/requisitions/[id]/vendor-order-dialog");
const { ReconcileDialog } = await import("@/app/(app)/requisitions/[id]/reconcile-dialog");
const { toItemModel } = await import("@/app/(app)/requisitions/[id]/item-model");
const { normalizeDetailRows } = await import("@/lib/data/requisition-detail");

const REQ = "00000000-0000-4000-8000-0000000000aa";
const api = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001", line_number: 1, description: "TEST — END TO END REQUISITION", quantity: 1, estimated_unit_price: 1, estimated_total: 1,
  review_status: "pending", approved_quantity: null, approved_unit_price: null, approved_total: 0, po_quantity: 0, ordered_quantity: 0, purchased_quantity: 0,
  actual_total: 0, cancelled_quantity: 0, review_comment: null, vendor_name: null, priority: "essential", essential_justification: "TEST ONLY — reason here", ...over,
});
// The same path the page uses: normalize at the boundary, then build models.
const models = (rows: Record<string, unknown>[]) =>
  normalizeDetailRows({ requisition: {}, items: rows, purchaseOrders: [], vendorOrders: [], receipts: [], disbursements: [] }).items.map((r) => toItemModel(r as never));
const approved = api({ review_status: "approved", approved_quantity: 1, approved_unit_price: 1, approved_total: 1 });
const reviewProps = { requisitionId: REQ, currency: "USD", costCenters: [], expenseCategories: [], currentCostCenterId: null, currentExpenseCategoryId: null };

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe("root cause", () => {
  it("un-normalized API rows reproduce the production crash in the Review dialog", () => {
    expect(() => renderToString(<ReviewDialog {...reviewProps} items={[api() as never]} />)).toThrow(/replace is not a function/);
  });
});

describe("Submitted requisition (Review)", () => {
  it("server-renders without crashing (the detail page's failure point)", () => {
    expect(() => renderToString(<ToastProvider><ReviewDialog {...reviewProps} items={models([api()])} /></ToastProvider>)).not.toThrow();
  });

  it("approves with numeric source data and sends strings to the server", async () => {
    render(<ToastProvider><ReviewDialog {...reviewProps} items={models([api({ quantity: 2.5, estimated_unit_price: 10.01 })])} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    // Wording never promises the requester is notified (that depends on notification configuration).
    expect(screen.getByText(/The decision is saved when you submit this review\. If requester notifications are configured, the requester may receive an update\./)).toBeTruthy();
    expect(screen.queryByText(/The requester is notified of the outcome/)).toBeNull();
    expect(screen.getByText(/Requested 2.5 × \$10.01/)).toBeTruthy();
    expect(screen.getByText("$25.03")).toBeTruthy(); // approved total preview: 2.5 × 10.01 = 25.025 → 25.03
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(calls.review).toBeTruthy());
    const input = calls.review[1] as { items: { approved_quantity: unknown; approved_unit_price: unknown }[] };
    expect(input.items[0]).toMatchObject({ approved_quantity: "2.5", approved_unit_price: "10.01" });
  });
});

describe("Purchase order / vendor order / reconciliation", () => {
  it("PO dialog prepares and submits from numeric data", async () => {
    render(<ToastProvider><PurchaseOrderDialog requisitionId={REQ} items={models([approved])} currency="USD" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Issue PO/ }));
    expect(screen.getByText("$1.00")).toBeTruthy();
    // The submit button promises no email: email may be unconfigured or fail (the result message says what happened).
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /email/i })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue PO" }));
    await waitFor(() => expect(calls.po).toBeTruthy());
    expect((calls.po[1] as { items: unknown[] }).items[0]).toMatchObject({ quantity: "1", unit_price: "1" });
  });

  it("vendor order dialog prepares and submits from numeric data", async () => {
    render(<ToastProvider><VendorOrderDialog requisitionId={REQ} items={models([approved])} currency="USD" purchaseOrders={[]} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Record order/ }));
    fireEvent.change(document.getElementById("vo_vendor")!, { target: { value: "TEST VENDOR" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record order" }).at(-1)!);
    await waitFor(() => expect(calls.order).toBeTruthy());
    expect((calls.order[1] as { items: unknown[] }).items[0]).toMatchObject({ quantity: "1", unit_price: "1" });
  });

  it("reconcile dialog handles numeric receipt totals and quantities", async () => {
    const n = normalizeDetailRows({ requisition: {}, items: [], purchaseOrders: [], vendorOrders: [], disbursements: [],
      receipts: [{ id: "rc", vendor_name: null, purchase_date: null, total_amount: 1.1, reference: null, purchase_order_id: null, receipt_item_allocations: [] }] });
    const receipt = n.receipts[0] as unknown as { id: string; vendor_name: null; purchase_date: null; total_amount: string | null; reference: null; purchase_order_id: null };
    render(<ToastProvider><ReconcileDialog requisitionId={REQ} receipt={receipt} items={models([api({ review_status: "approved", approved_quantity: 1, approved_unit_price: 1, approved_total: 1, ordered_quantity: 1 })])} purchaseOrderItems={[]} currency="USD" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Reconcile/ }));
    fireEvent.change(screen.getByLabelText(/Qty bought/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Actual cost/), { target: { value: "1.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reconciliation" }));
    await waitFor(() => expect(calls.reconcile).toBeTruthy());
    const input = calls.reconcile[2] as { total_amount: unknown; allocations: { quantity: unknown; actual_amount: unknown }[] };
    expect(input.total_amount).toBe("1.1");
    expect(input.allocations[0]).toMatchObject({ quantity: "1", actual_amount: "1.10" });
  });
});
