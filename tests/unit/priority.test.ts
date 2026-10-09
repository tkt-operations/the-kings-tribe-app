import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/email/layout";
import { financeSubmissionSubject, priorityAlert, priorityRowFields } from "@/lib/email/requisition-priority";
import { comparePriority, countByPriority, DEFAULT_PRIORITY, highestPriority, PRIORITIES, priorityRank } from "@/lib/priority";
import { requisitionItemsCsv, requisitionsCsv } from "@/lib/report-csv";
import { summarizeItemPriorities, summarizeRequisitions, type RequisitionItemReportRow, type RequisitionReportRow } from "@/lib/reports";
import { buildRequisitionSchema, EMPTY_LINE_ITEM, toDatabasePayload } from "@/lib/validation/requisition";

const ORDER = "11111111-1111-4111-8111-111111111111";
const schema = buildRequisitionSchema({
  today: "2026-10-05",
  requestTypes: [{ id: ORDER, name: "Order", requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: false, max_total: null }],
});
const base = {
  requester_name: "Jordan Example", requester_email: "jordan@example.org", requester_phone: "(555) 010-2000",
  department_head_name: "Jordan Example", department_id: "44444444-4444-4444-8444-444444444444",
  subcategory_id: "55555555-5555-4555-8555-555555555555", request_type_id: ORDER, cost_center_id: "",
  needed_by: "2026-10-12", budget_status: "yes" as const, budget_explanation: "",
  justification: "Equipment for Sunday production and live stream.", certification_accepted: true as const, certification_name: "Jordan Example",
};
const item = (over: Record<string, unknown>) => ({ ...EMPTY_LINE_ITEM, description: "Wireless mic", quantity: "2", estimated_unit_price: "600", ...over });
const issues = (input: unknown) => {
  const r = schema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("priority basics", () => {
  it("defaults new line items to Medium", () => {
    expect(DEFAULT_PRIORITY).toBe("medium");
    expect(EMPTY_LINE_ITEM.priority).toBe("medium");
    expect(EMPTY_LINE_ITEM.essential_justification).toBe("");
  });

  it("orders Essential > High > Medium > Low (Essential is distinct from High)", () => {
    expect([...PRIORITIES]).toEqual(["essential", "high", "medium", "low"]);
    expect(priorityRank("essential")).toBeLessThan(priorityRank("high"));
    expect(["low", "essential", "medium", "high"].sort(comparePriority)).toEqual(["essential", "high", "medium", "low"]);
  });

  it("calculates the highest priority from the items; a Low item never hides an Essential one", () => {
    expect(highestPriority([{ priority: "low" }, { priority: "essential" }, { priority: "medium" }])).toBe("essential");
    expect(highestPriority([{ priority: "medium" }, { priority: "high" }])).toBe("high");
    expect(highestPriority([])).toBeNull();
    expect(countByPriority([{ priority: "essential" }, { priority: "essential" }, { priority: "low" }])).toEqual({ essential: 2, high: 0, medium: 0, low: 1 });
  });
});

describe("requisition schema priority rules", () => {
  it("accepts each priority; only Essential needs a justification", () => {
    for (const priority of ["high", "medium", "low"]) expect(issues({ ...base, items: [item({ priority })] })).toEqual({});
    expect(issues({ ...base, items: [item({ priority: "essential", essential_justification: "Replaces the failed mic before Sunday." })] })).toEqual({});
  });

  it("blocks Essential without a justification", () => {
    expect(issues({ ...base, items: [item({ priority: "essential", essential_justification: "" })] })).toEqual({ "items.0.essential_justification": "Explain why this item is essential" });
    expect(issues({ ...base, items: [item({ priority: "essential", essential_justification: "asap" })] })["items.0.essential_justification"]).toMatch(/at least 10 characters/);
  });

  it("requires a valid priority on each line", () => {
    expect(issues({ ...base, items: [item({ priority: undefined })] })).toHaveProperty("items.0.priority", "Choose a priority for this item");
    expect(issues({ ...base, items: [item({ priority: "urgent" })] })).toHaveProperty("items.0.priority");
  });

  it("keeps priorities independent per line and drops justifications on non-Essential lines", () => {
    const parsed = schema.parse({
      ...base,
      items: [
        item({ priority: "essential", essential_justification: "Replaces the failed mic before Sunday." }),
        item({ description: "XLR cables", priority: "low", essential_justification: "left over from switching" }),
        item({ description: "Stands", priority: "high" }),
      ],
    });
    const payload = toDatabasePayload(parsed).items;
    expect(payload.map((i) => i.priority)).toEqual(["essential", "low", "high"]);
    expect(payload.map((i) => i.essential_justification)).toEqual(["Replaces the failed mic before Sunday.", null, null]);
  });
});

describe("submission email priority content", () => {
  const essentialItems = [
    { priority: "essential", essential_justification: "Required to replace failed equipment before Sunday service." },
    { priority: "medium", essential_justification: null },
    { priority: "essential", essential_justification: "Live stream is down without it." },
  ];

  it("adds [ESSENTIAL] to the Finance subject only when an Essential item is included", () => {
    const base = "New requisition TKT-REQ-2026-0001 — Production Team ($1,360.00)";
    expect(financeSubmissionSubject(base, essentialItems)).toBe(`[ESSENTIAL] ${base}`);
    expect(financeSubmissionSubject(base, [{ priority: "high" }, { priority: "low" }])).toBe(base);
  });

  it("calls out Essential items (with count), else High items, else nothing", () => {
    expect(priorityAlert(essentialItems)).toMatchObject({ tone: "essential", title: "Essential item included" });
    expect(priorityAlert(essentialItems)!.body).toContain("2 Essential items");
    expect(priorityAlert([{ priority: "high" }, { priority: "medium" }])).toMatchObject({ tone: "high", title: "High-priority item included" });
    expect(priorityAlert([{ priority: "medium" }, { priority: "low" }])).toBeUndefined();
  });

  it("renders the words ESSENTIAL/MEDIUM per line and the justification, in HTML and plain text", () => {
    const items = [
      { description: "Wireless Microphone System", quantity: "2", amount: "$1,200.00", ...priorityRowFields(essentialItems[0]) },
      { description: "XLR Cables", quantity: "4", amount: "$160.00", ...priorityRowFields({ priority: "medium" }) },
    ];
    const { html, text } = renderEmail(
      { preheader: "p", heading: "New requisition to review", paragraphs: ["x"], items, alert: priorityAlert(essentialItems) },
      { appUrl: "https://ops.example.org", churchName: "The Kings Tribe", churchLines: [] },
    );
    expect(html).toContain("Essential item included");
    expect(html).toContain(">ESSENTIAL<");
    expect(html).toContain(">MEDIUM<");
    expect(html).toContain("Essential justification: Required to replace failed equipment before Sunday service.");
    expect(html.indexOf("Essential item included")).toBeLessThan(html.indexOf("New requisition to review</h1>") + 1000);
    expect(text).toContain("*** ESSENTIAL ITEM INCLUDED ***");
    expect(text).toContain("- [ESSENTIAL] Wireless Microphone System × 2 — $1,200.00");
    expect(text).toContain("  Essential justification: Required to replace failed equipment before Sunday service.");
    expect(text).toContain("- [MEDIUM] XLR Cables × 4 — $160.00");
  });

  it("escapes requester-supplied justification text", () => {
    const { html } = renderEmail(
      { preheader: "p", heading: "h", paragraphs: [], items: [{ description: "Mic", quantity: "1", amount: "$1", ...priorityRowFields({ priority: "essential", essential_justification: "<img src=x onerror=alert(1)>" }) }] },
      { appUrl: "https://ops.example.org", churchName: "TKT", churchLines: [] },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("priority reporting", () => {
  const line = (over: Partial<RequisitionItemReportRow>): RequisitionItemReportRow => ({
    requisition_id: "r1", requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-05T12:00:00Z", status: "approved",
    department: "Production Team", line_number: 1, description: "Mic", priority: "medium", essential_justification: null,
    quantity: "1.00", estimated_total: "10.00", review_status: "approved", approved_total: "10.00", actual_total: "0.00", ...over,
  });
  const items = [
    line({ priority: "essential", essential_justification: "Needed Sunday", estimated_total: "1200.00", approved_total: "1200.00", actual_total: "1150.00" }),
    line({ line_number: 2, priority: "medium", estimated_total: "160.00", approved_total: "160.00" }),
    line({ requisition_id: "r2", requisition_number: "TKT-REQ-2026-0002", priority: "essential", essential_justification: "Safety", estimated_total: "50.00", approved_total: "0.00", review_status: "rejected" }),
  ];

  it("summarises counts and spend per priority without changing requisition totals", () => {
    const buckets = summarizeItemPriorities(items);
    expect(buckets.map((b) => b.priority)).toEqual(["essential", "high", "medium", "low"]);
    expect(buckets[0]).toMatchObject({ count: 2, requisitions: 2, requested: 125000n, approved: 120000n, actual: 115000n });
    expect(buckets[1]).toMatchObject({ count: 0, requested: 0n });
    expect(buckets[2]).toMatchObject({ count: 1, requested: 16000n });
    // Requisition-level totals come only from requisition rows, unaffected by priority.
    const reqRow: RequisitionReportRow = { id: "r1", requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-05T12:00:00Z", status: "approved", estimated_total: "1360.00", approved_total: "1360.00", actual_total: "1150.00", department: "Production Team", subcategory: "Audio", request_type: "Order", expense_category: null, highest_item_priority: "essential", essential_item_count: 1 };
    expect(summarizeRequisitions([reqRow]).totals.requested).toBe(136000n);
  });

  it("exports Line Item Priority and Essential Justification per line", () => {
    const csv = requisitionItemsCsv(items, "UTC");
    const [header, first, , third] = csv.trim().split("\r\n");
    expect(header).toContain("Line Item Priority,Essential Justification");
    expect(first).toContain("Mic,Essential,Needed Sunday,1.00,1200.00,Approved");
    expect(third).toContain("Essential,Safety");
    expect(third).toContain("Rejected");
  });

  it("adds highest priority and Essential count to the requisitions CSV", () => {
    const csv = requisitionsCsv([{ id: "r1", requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-05T12:00:00Z", status: "approved", estimated_total: "1360.00", approved_total: "1360.00", actual_total: "1150.00", department: "Production Team", subcategory: "Audio", request_type: "Order", expense_category: null, highest_item_priority: "essential", essential_item_count: 2 }], "UTC");
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toContain("Highest item priority,Essential items");
    expect(row).toContain("Approved,Essential,2,1360.00,1360.00,1150.00,-210.00");
  });
});
