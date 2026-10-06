/** API-shaped numerics (JSON numbers from PostgREST) → canonical decimal strings. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decimalOrNull, decimalString } = await import("@/lib/data/decimal");
const { normalizeDetailRows } = await import("@/lib/data/requisition-detail");
const { toItemModel } = await import("@/app/(app)/requisitions/[id]/item-model");
const { numericToCents, parseMoney, parseQuantity, sumCents } = await import("@/lib/money");

describe("decimalString", () => {
  it("turns API numbers into exact decimal strings", () => {
    expect(decimalString(1)).toBe("1");
    expect(decimalString(2.5)).toBe("2.5");
    expect(decimalString(1.1)).toBe("1.1");
    expect(decimalString(19.99)).toBe("19.99");
    expect(decimalString(0)).toBe("0");
    expect(decimalString(10000000)).toBe("10000000");
    expect(decimalString(99999999999.99)).toBe("99999999999.99");
  });

  it("keeps strings exactly as received (SQL functions return text)", () => {
    expect(decimalString("1.00")).toBe("1.00");
    expect(decimalString("1360.00")).toBe("1360.00");
  });

  it("handles null/undefined: 0 for required, null for optional", () => {
    expect(decimalString(null)).toBe("0");
    expect(decimalOrNull(null)).toBeNull();
    expect(decimalOrNull(undefined)).toBeNull();
    expect(decimalOrNull(2)).toBe("2");
    expect(() => decimalString(Number.NaN)).toThrow();
  });

  it("never changes the amount: number and string forms parse to the same cents", () => {
    for (const [n, s] of [[1, "1.00"], [1.1, "1.10"], [0.55, "0.55"], [1360, "1360.00"], [25.025, "25.03"]] as const) {
      if (n === 25.025) continue; // not a valid stored numeric(…,2) value
      expect(parseMoney(decimalString(n))).toBe(parseMoney(s));
      expect(numericToCents(decimalString(n))).toBe(numericToCents(s));
    }
  });
});

// Exactly what supabase-js returns for TKT-REQ-2026-0001-like rows.
const apiItem = {
  id: "00000000-0000-4000-8000-000000000001", requisition_id: "00000000-0000-4000-8000-0000000000aa", line_number: 1,
  description: "TEST — END TO END REQUISITION", quantity: 1, estimated_unit_price: 1, estimated_total: 1, review_status: "pending",
  approved_quantity: null, approved_unit_price: null, approved_total: 0, po_quantity: 0, ordered_quantity: 0, purchased_quantity: 0,
  actual_total: 0, cancelled_quantity: 0, review_comment: null, vendor_name: null, priority: "essential",
  essential_justification: "TEST ONLY — verifying Essential priority workflow and notification handling.",
};

describe("normalizeDetailRows (requisition detail data boundary)", () => {
  const n = normalizeDetailRows({
    requisition: { id: "r", estimated_total: 1, approved_total: 0, actual_total: 0, disbursed_total: 0, actual_purchase_amount: null, requisition_number: "TKT-REQ-2026-0001" },
    items: [apiItem, { ...apiItem, id: "i2", line_number: 2, quantity: 2.5, estimated_unit_price: 10.01, estimated_total: 25.03, approved_quantity: 2.5, approved_unit_price: 9.99, approved_total: 24.98 }],
    purchaseOrders: [{ id: "po", total: 1, purchase_order_items: [{ id: "poi", quantity: 1, unit_price: 1, line_total: 1 }] }],
    vendorOrders: [{ id: "vo", total: 0.5, vendor_order_items: [{ requisition_item_id: "i", quantity: 0.5, unit_price: 1, line_total: 0.5 }] }],
    receipts: [{ id: "rc", total_amount: 1.1, receipt_item_allocations: [{ requisition_item_id: "i", quantity: 0.5, actual_amount: 0.55 }] }, { id: "rc2", total_amount: null, receipt_item_allocations: [] }],
    disbursements: [{ id: "d", amount: 1 }],
  });

  it("returns only strings (or null where optional) for every quantity and amount", () => {
    expect(n.requisition).toMatchObject({ estimated_total: "1", approved_total: "0", actual_total: "0", disbursed_total: "0", actual_purchase_amount: null, requisition_number: "TKT-REQ-2026-0001" });
    expect(n.items[0]).toMatchObject({ quantity: "1", estimated_unit_price: "1", estimated_total: "1", approved_quantity: null, approved_unit_price: null, approved_total: "0", po_quantity: "0", ordered_quantity: "0", purchased_quantity: "0", actual_total: "0", cancelled_quantity: "0" });
    expect(n.items[1]).toMatchObject({ quantity: "2.5", estimated_unit_price: "10.01", approved_quantity: "2.5", approved_unit_price: "9.99", approved_total: "24.98" });
    expect(n.purchaseOrders[0]).toMatchObject({ total: "1", purchase_order_items: [{ quantity: "1", unit_price: "1", line_total: "1" }] });
    expect(n.vendorOrders[0]).toMatchObject({ total: "0.5", vendor_order_items: [{ quantity: "0.5", unit_price: "1", line_total: "0.5" }] });
    expect(n.receipts[0]).toMatchObject({ total_amount: "1.1", receipt_item_allocations: [{ quantity: "0.5", actual_amount: "0.55" }] });
    expect(n.receipts[1].total_amount).toBeNull();
    expect(n.disbursements[0]).toMatchObject({ amount: "1" });
  });

  it("leaves non-numeric fields untouched (priority, justification, ids)", () => {
    expect(n.items[0]).toMatchObject({ id: apiItem.id, priority: "essential", essential_justification: apiItem.essential_justification, review_status: "pending" });
  });

  it("keeps totals exact", () => {
    expect(sumCents(n.items.map((i) => parseMoney(i.estimated_total as string)!))).toBe(2603n);
    expect(parseQuantity(n.items[1].quantity as string)).toBe(250n);
  });

  it("is compatible with string-shaped input", () => {
    const s = normalizeDetailRows({ requisition: { estimated_total: "1.00" }, items: [{ ...apiItem, quantity: "1.00", estimated_unit_price: "1.00" }], purchaseOrders: null, vendorOrders: undefined, receipts: [], disbursements: [] });
    expect(s.requisition.estimated_total).toBe("1.00");
    expect(s.items[0]).toMatchObject({ quantity: "1.00", estimated_unit_price: "1.00" });
    expect(s.purchaseOrders).toEqual([]);
  });
});

describe("toItemModel", () => {
  it("produces string quantities/prices from numeric API rows (and keeps strings)", () => {
    const m = toItemModel(apiItem as never);
    expect(m).toMatchObject({ quantity: "1", estimatedUnitPrice: "1", approvedQuantity: null, approvedUnitPrice: null, approvedTotal: "0", priority: "essential" });
    expect(typeof m.quantity.replace).toBe("function");
    expect(toItemModel({ ...apiItem, quantity: "3.00" } as never).quantity).toBe("3.00");
  });
});
