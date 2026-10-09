/**
 * Requisition list "Submitted" date: the church-timezone calendar date of the
 * real timestamp, matching the detail page. Regression: the list took the UTC
 * date (`submitted_at.slice(0, 10)`), so evening submissions in the Americas
 * showed the next day.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDateTime, formatTimestampDate } from "@/lib/dates";
import { RequisitionTable, type RequisitionListRow } from "@/app/(app)/requisitions/requisition-list";
import { requisitionItemsCsv, requisitionsCsv } from "@/lib/report-csv";

describe("formatTimestampDate", () => {
  it.each([
    // 10:28 PM Eastern on Oct 7 is already Oct 8 in UTC.
    ["2026-10-08T02:28:00Z", "America/New_York", "Oct 7"],
    ["2026-10-08T02:28:00Z", "America/Chicago", "Oct 7"],
    ["2026-10-08T02:28:00Z", "UTC", "Oct 8"],
    // Just before and after local midnight.
    ["2026-10-08T03:59:59Z", "America/New_York", "Oct 7"],
    ["2026-10-08T04:00:00Z", "America/New_York", "Oct 8"],
    // Ahead of UTC: an early-morning submission belongs to the next local day.
    ["2026-10-07T23:30:00Z", "Africa/Lagos", "Oct 8"],
    // Daylight-saving change (US, Nov 1 2026): 11:30 PM local on Nov 1.
    ["2026-11-02T04:30:00Z", "America/New_York", "Nov 1"],
  ])("%s in %s is %s", (ts, tz, expected) => {
    expect(formatTimestampDate(ts, tz, "short")).toBe(expected);
    // Always the same calendar day the detail page shows.
    expect(formatDateTime(ts, tz)).toContain(`${expected},`);
  });

  it("handles missing or invalid timestamps", () => {
    expect(formatTimestampDate(null, "UTC")).toBe("—");
    expect(formatTimestampDate("not a date", "UTC")).toBe("—");
  });
});

describe("RequisitionTable", () => {
  const row = (id: string, submitted_at: string): RequisitionListRow => ({
    id, requisition_number: `TKT-REQ-2026-${id}`, submitted_at, requester_name: "Jamie Carter", needed_by: "2026-10-21",
    estimated_total: "10.00", status: "submitted", is_demo: false, assigned_reviewer_id: null,
    departments: { name: "Hospitality Team" }, department_subcategories: null, request_types: { name: "Order" },
    highest_item_priority: "medium", essential_item_count: 0,
  });

  it("shows the church-timezone date and keeps the server's timestamp order", () => {
    const html = renderToStaticMarkup(createElement(RequisitionTable, {
      rows: [row("0002", "2026-10-08T02:28:00Z"), row("0001", "2026-10-07T14:00:00Z")],
      currency: "USD", timezone: "America/New_York", reviewerName: () => "—",
    }));
    expect(html).not.toContain("Submitted Oct 8");
    expect(html.match(/Submitted Oct 7/g)).toHaveLength(2);
    expect(html.indexOf("TKT-REQ-2026-0002")).toBeLessThan(html.indexOf("TKT-REQ-2026-0001"));
  });
});

describe("report CSV Submitted column", () => {
  const req = (submitted_at: string) => ({ id: "r1", requisition_number: "TKT-REQ-2026-0001", submitted_at, status: "submitted", estimated_total: "10.00", approved_total: "0.00", actual_total: "0.00", department: "Hospitality Team", subcategory: "Supplies", request_type: "Order", expense_category: null, highest_item_priority: "medium" as const, essential_item_count: 0 });
  const item = (submitted_at: string) => ({ requisition_number: "TKT-REQ-2026-0001", submitted_at, department: "Hospitality Team", status: "submitted", line_number: 1, description: "Cups", priority: "medium" as const, essential_justification: null, quantity: "2.00", estimated_total: "10.00", review_status: "pending", approved_total: "0.00", actual_total: "0.00" });
  const secondColumn = (csv: string) => csv.split(/\r?\n/)[1].split(",")[1];

  it.each([
    ["2026-10-08T02:28:00Z", "America/New_York", "2026-10-07"],
    ["2026-10-08T02:28:00Z", "UTC", "2026-10-08"],
    ["2026-10-08T04:00:00Z", "America/New_York", "2026-10-08"],
    ["2026-10-07T23:30:00Z", "Africa/Lagos", "2026-10-08"],
  ])("%s in %s exports %s, in both requisition exports", (ts, tz, expected) => {
    expect(secondColumn(requisitionsCsv([req(ts)] as never, tz))).toBe(expected);
    expect(secondColumn(requisitionItemsCsv([item(ts)] as never, tz))).toBe(expected);
  });

  it("keeps every column and the header unchanged", () => {
    const csv = requisitionsCsv([req("2026-10-07T14:00:00Z")] as never, "America/New_York");
    expect(csv.split(/\r?\n/)[0]).toContain("Requisition #,Submitted,Department,Subcategory,Request type");
    expect(csv.split(/\r?\n/)[1].split(",")).toHaveLength(csv.split(/\r?\n/)[0].split(",").length);
  });
});
