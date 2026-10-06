import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { summarizeRequisitions, type RequisitionReportRow } from "@/lib/reports";
import { centsToDecimal } from "@/lib/money";

const row = (o: Partial<RequisitionReportRow>): RequisitionReportRow => ({
  id: Math.random().toString(), requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-01T10:00:00Z", status: "submitted",
  estimated_total: "0", approved_total: "0", actual_total: "0", department: "Hospitality Team", subcategory: "Guest Experience",
  request_type: "Order", expense_category: null, ...o,
});

describe("requisition report", () => {
  const rows = [
    row({ status: "purchased", estimated_total: "100.00", approved_total: "90.00", actual_total: "95.50", expense_category: "Supplies" }),
    row({ status: "closed", estimated_total: "50.00", approved_total: "50.00", actual_total: "48.00", department: "Production Team", request_type: "Reimbursement" }),
    row({ status: "rejected", estimated_total: "300.00" }),
    row({ status: "ordered", estimated_total: "20.00", approved_total: "20.00" }),
    row({ status: "submitted", estimated_total: "10.10" }),
  ];
  const s = summarizeRequisitions(rows);
  it("totals and groups exactly", () => {
    expect(centsToDecimal(s.totals.requested)).toBe("480.10");
    expect(s.byDepartment[0]).toMatchObject({ key: "Hospitality Team", count: 4 });
    expect(s.byRequestType.map((b) => b.key)).toEqual(["Order", "Reimbursement"]);
  });
  it("counts approved, rejected, open and awaiting", () => {
    expect(s.approvedCount).toBe(3);
    expect(s.rejectedCount).toBe(1);
    expect(s.openCount).toBe(3);
    expect(s.awaitingReceipts).toHaveLength(1);
    expect(s.awaitingPurchase).toHaveLength(1);
  });
  it("computes estimated vs actual and purchase variance", () => {
    expect(s.completed.count).toBe(2);
    expect(centsToDecimal(s.completed.actual)).toBe("143.50");
    expect(centsToDecimal(s.completed.variance)).toBe("3.50");
  });
});

describe("csv", () => {
  it("escapes and neutralises formulas", () => {
    const csv = toCsv(["Name", "Amount"], [["=HYPERLINK(\"x\")", { number: "-12.50" }], ["Smith, \"Jo\"", 3], ["@cmd", null]]);
    expect(csv).toBe('Name,Amount\r\n"\'=HYPERLINK(""x"")",-12.50\r\n"Smith, ""Jo""",3\r\n\'@cmd,\r\n');
  });
});
