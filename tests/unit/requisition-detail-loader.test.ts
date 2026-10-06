/** loadRequisitionDetail with API-shaped (numeric) query results. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ID = "00000000-0000-4000-8000-0000000000aa";
const data: Record<string, unknown> = {
  requisitions: { id: ID, requisition_number: "TKT-REQ-2026-0001", status: "submitted", estimated_total: 1, approved_total: 0, actual_total: 0, disbursed_total: 0, actual_purchase_amount: null,
    departments: { id: "d", name: "Production Team" }, department_subcategories: { id: "s", name: "Audio Production" }, request_types: { id: "t", name: "Order" }, cost_centers: null, categories: null },
  requisition_items: [{ id: "i1", line_number: 1, description: "TEST — END TO END REQUISITION", quantity: 1, estimated_unit_price: 1, estimated_total: 1, review_status: "pending",
    approved_quantity: null, approved_unit_price: null, approved_total: 0, po_quantity: 0, ordered_quantity: 0, purchased_quantity: 0, actual_total: 0, cancelled_quantity: 0, priority: "essential", essential_justification: "TEST ONLY — reason" }],
  purchase_orders: [], vendor_orders: [], receipts: [{ id: "rc", total_amount: 1, receipt_item_allocations: [], receipt_files: [] }], disbursements: [],
  requisition_status_history: [], requisition_comments: [], audit_logs: [], notifications: [], profiles: [],
};
function query(table: string) {
  const result = { data: data[table] ?? [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => result;
  q.then = (resolve: (v: unknown) => void) => resolve(result);
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: (t: string) => query(t) }) }));

const { loadRequisitionDetail } = await import("@/lib/data/requisition-detail");

describe("loadRequisitionDetail", () => {
  it("loads a Submitted requisition whose numeric columns arrive as numbers", async () => {
    const d = await loadRequisitionDetail(ID);
    expect(d).not.toBeNull();
    expect(d!.estimated_total).toBe("1");
    expect(d!.items[0]).toMatchObject({ quantity: "1", estimated_unit_price: "1", estimated_total: "1", approved_quantity: null, priority: "essential" });
    expect(d!.receipts[0].total_amount).toBe("1");
    expect(d!.department.name).toBe("Production Team");
  });
});
