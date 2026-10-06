import { describe, expect, it } from "vitest";
import { buildRequisitionSchema, estimatedTotal, toDatabasePayload } from "@/lib/validation/requisition";
import { centsToDecimal } from "@/lib/money";

const ORDER = "11111111-1111-4111-8111-111111111111";
const REIMB = "22222222-2222-4222-8222-222222222222";
const PETTY = "33333333-3333-4333-8333-333333333333";
const types = [
  { id: ORDER, name: "Order", requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: false, max_total: null },
  { id: REIMB, name: "Reimbursement", requires_receipt_on_submission: true, requires_purchase_details: true, requires_cost_center: false, max_total: null },
  { id: PETTY, name: "Petty Cash", requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: true, max_total: "100.00" },
];
const schema = buildRequisitionSchema({ today: "2026-10-05", requestTypes: types });

const valid = {
  requester_name: "Jordan Example",
  requester_email: "JORDAN@example.org ",
  requester_phone: "(555) 010-2000",
  department_head_name: "Jordan Example",
  department_id: "44444444-4444-4444-8444-444444444444",
  subcategory_id: "55555555-5555-4555-8555-555555555555",
  request_type_id: ORDER,
  cost_center_id: "",
  needed_by: "2026-10-12",
  budget_status: "yes" as const,
  budget_explanation: "",
  justification: "Supplies for the guest welcome table on Sundays.",
  items: [
    { description: "Coffee", quantity: "3", estimated_unit_price: "19.99", vendor_url: "" },
    { description: "Cups", quantity: "2.5", estimated_unit_price: "10.01" },
  ],
  certification_accepted: true as const,
  certification_name: "Jordan Example",
};

function errors(input: unknown) {
  const r = schema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("requisition validation", () => {
  it("accepts a valid Order and normalizes email", () => {
    const r = schema.parse(valid);
    expect(r.requester_email).toBe("jordan@example.org");
    expect(centsToDecimal(estimatedTotal(r.items)!)).toBe("85.00");
    expect(toDatabasePayload(r).items[1]).toMatchObject({ quantity: "2.5", estimated_unit_price: "10.01", color: null });
  });

  it("requires core fields", () => {
    const e = errors({ ...valid, requester_email: "nope", requester_phone: "12", needed_by: "2026-10-01", justification: "short", items: [] });
    expect(Object.keys(e)).toEqual(expect.arrayContaining(["requester_email", "requester_phone", "needed_by", "justification", "items"]));
  });

  it("requires a budget explanation when not within budget", () => {
    expect(errors({ ...valid, budget_status: "unsure" })).toHaveProperty("budget_explanation");
    expect(errors({ ...valid, budget_status: "no", budget_explanation: "Over by $20 this month" })).toEqual({});
  });

  it("validates line items", () => {
    const e = errors({ ...valid, items: [{ description: "X", quantity: "0", estimated_unit_price: "1.234", vendor_url: "example.com" }] });
    expect(Object.keys(e)).toEqual(expect.arrayContaining(["items.0.description", "items.0.quantity", "items.0.estimated_unit_price", "items.0.vendor_url"]));
  });

  it("applies Reimbursement rules", () => {
    const e = errors({ ...valid, request_type_id: REIMB });
    expect(Object.keys(e)).toEqual(expect.arrayContaining(["actual_purchase_amount", "purchase_vendor", "purchase_date", "receipt_count"]));
    expect(
      errors({ ...valid, request_type_id: REIMB, actual_purchase_amount: "85.00", purchase_vendor: "Shop", purchase_date: "2026-10-01", receipt_count: 1 }),
    ).toEqual({});
    expect(errors({ ...valid, request_type_id: REIMB, actual_purchase_amount: "85", purchase_vendor: "Shop", purchase_date: "2026-11-01", receipt_count: 1 }))
      .toHaveProperty("purchase_date");
  });

  it("applies Petty Cash cost center and limit rules", () => {
    const e = errors({ ...valid, request_type_id: PETTY, items: [{ description: "Snacks", quantity: "1", estimated_unit_price: "100.01" }] });
    expect(e).toHaveProperty("cost_center_id");
    expect(e).toHaveProperty("items");
  });

  it("requires the certification", () => {
    expect(errors({ ...valid, certification_accepted: false })).toHaveProperty("certification_accepted");
  });
});
