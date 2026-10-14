/** Amendment change list, gating and display (lib/amendments.ts). */
import { describe, expect, it } from "vitest";
import { buildAmendmentChanges, canAmend, changedFields, displayValue, EMPTY_LINE, isAmendable, type ExistingLine } from "@/lib/amendments";
import { REQUISITION_STATUSES } from "@/lib/workflow/status";

const line = (over: Partial<ExistingLine> = {}): ExistingLine => ({
  ...EMPTY_LINE, id: "00000000-0000-4000-8000-000000000001", line: 1, description: "Coffee beans", quantity: "3", estimated_unit_price: "19.99", ...over,
});

describe("gating", () => {
  it("Phase 1 amends only submitted, under-review and on-hold requisitions", () => {
    expect(REQUISITION_STATUSES.filter(isAmendable)).toEqual(["submitted", "under_review", "on_hold"]);
  });
  it("needs requisitions.amend", () => {
    const yes = { has: () => true };
    const no = { has: () => false };
    expect(canAmend(yes, "submitted")).toBe(true);
    expect(canAmend(no, "submitted")).toBe(false);
    expect(canAmend(yes, "approved")).toBe(false);
    expect(canAmend(yes, "po_issued")).toBe(false);
  });
});

describe("changedFields", () => {
  it("compares numbers by value and text trimmed", () => {
    expect(changedFields(line(), { ...line(), quantity: "3.00", description: " Coffee beans " })).toEqual({});
    expect(changedFields(line(), { ...line(), quantity: "4", estimated_unit_price: "18" })).toEqual({ quantity: "4", estimated_unit_price: "18" });
  });
  it("ignores the essential reason unless the line is Essential", () => {
    expect(changedFields(line(), { ...line(), essential_justification: "typed then switched back" })).toEqual({});
    expect(changedFields(line(), { ...line(), priority: "essential", essential_justification: "Needed for Sunday." }))
      .toEqual({ priority: "essential", essential_justification: "Needed for Sunday." });
  });
});

describe("buildAmendmentChanges", () => {
  it("emits updates for changed lines, removals and additions — nothing for untouched lines", () => {
    const a = line();
    const b = line({ id: "00000000-0000-4000-8000-000000000002", line: 2, description: "Cups" });
    const c = line({ id: "00000000-0000-4000-8000-000000000003", line: 3, description: "Lids" });
    const changes = buildAmendmentChanges(
      [a, b, c],
      { [a.id]: { ...a, quantity: "5" }, [c.id]: { ...c } },
      { [b.id]: "  In stock  " },
      [{ ...EMPTY_LINE, description: " Sugar ", estimated_unit_price: "2", essential_justification: "dropped" }],
    );
    expect(changes).toEqual([
      { op: "update", item_id: a.id, fields: { quantity: "5" } },
      { op: "remove", item_id: b.id, reason: "In stock" },
      { op: "add", fields: { ...EMPTY_LINE, description: "Sugar", estimated_unit_price: "2", essential_justification: "" } },
    ]);
  });
  it("omits an empty removal reason (the amendment reason is used)", () => {
    const a = line();
    expect(buildAmendmentChanges([a], {}, { [a.id]: " " }, [])).toEqual([{ op: "remove", item_id: a.id }]);
  });
});

describe("displayValue", () => {
  const money = (v: string) => `$${Number(v).toFixed(2)}`;
  it.each([
    ["quantity", 3, "3"],
    ["quantity", "2.50", "2.5"],
    ["estimated_unit_price", 19.99, "$19.99"],
    ["priority", "essential", "Essential"],
    ["notes", null, "—"],
    ["description", "Cups", "Cups"],
  ])("%s %j → %s", (field, value, expected) => {
    expect(displayValue(field, value, money)).toBe(expected);
  });
});
