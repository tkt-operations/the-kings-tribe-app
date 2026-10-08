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
