// @vitest-environment jsdom
/** Why-essential presentation and list/lifecycle priority display. */
import "./setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EssentialReason, ESSENTIAL_REASON_INLINE_MAX } from "@/components/ui/essential-reason";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const { LineItemsTable } = await import("@/app/(app)/requisitions/[id]/line-items-table");
const { RequisitionCards, RequisitionTable } = await import("@/app/(app)/requisitions/requisition-list");

const SHORT = "TEST ONLY — verifying Essential priority workflow and notification handling.";
const LONG = "Our only wireless microphone receiver failed during last Sunday's service and the backup unit is on loan to the youth ministry until next month. Without a replacement we cannot run the worship set or the live stream audio.";

describe("EssentialReason", () => {
  it("shows a short reason inline as compact metadata (no alert styling, no icon)", () => {
    render(<EssentialReason reason={SHORT} />);
    const el = screen.getByTestId("essential-reason");
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe(`Why essential: ${SHORT}`);
    expect(el.className).not.toMatch(/bg-energy-orange|rounded-lg|px-2 py-1/);
    expect(el.querySelector("svg")).toBeNull();
    expect(within(el).getByText("Why essential:").className).toContain("font-semibold");
  });

  it("puts a long reason behind a keyboard-accessible disclosure with the full text", () => {
    expect(LONG.length).toBeGreaterThan(ESSENTIAL_REASON_INLINE_MAX);
    render(<EssentialReason reason={LONG} />);
    const details = screen.getByTestId("essential-reason") as HTMLDetailsElement;
    expect(details.tagName).toBe("DETAILS");
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toContain("Why essential");
    expect(summary.textContent).toContain("View reason");
    expect(details.textContent).toContain(LONG); // full text is in the DOM, never truncated or hover-only
    fireEvent.click(summary);
    expect(details.open).toBe(true);
  });

  it("renders nothing without a reason", () => {
    const { container } = render(<EssentialReason reason={"  "} />);
    expect(container.textContent).toBe("");
  });
});

const line = (o: object) => ({
  id: Math.random().toString(), line_number: 1, description: "TEST — END TO END REQUISITION", specifications: null, color: null, size: null, vendor_name: null, vendor_url: null, notes: null,
  review_status: "approved", review_comment: null, quantity: "1", estimated_unit_price: "1", estimated_total: "1", approved_quantity: "1", approved_unit_price: "1", approved_total: "1",
  po_quantity: "1", ordered_quantity: "1", purchased_quantity: "1", actual_total: "1", cancelled_quantity: "0", cancel_reason: null, priority: "essential", essential_justification: SHORT, ...o,
});

describe("lifecycle table", () => {
  it("shows badge, description and compact reason for Essential; nothing for others", () => {
    render(<LineItemsTable currency="USD" items={[line({}), line({ line_number: 2, description: "XLR cables", priority: "medium", essential_justification: null }), line({ line_number: 3, description: "Stale reason", priority: "high", essential_justification: "should not show" })] as never} />);
    const rows = screen.getAllByTestId("item-cell");
    expect(rows[0].querySelector('[data-priority="essential"]')!.textContent).toBe("Priority: Essential");
    expect(within(rows[0]).getByTestId("essential-reason").textContent).toContain(SHORT);
    expect(within(rows[1]).queryByTestId("essential-reason")).toBeNull();
    expect(within(rows[2]).queryByTestId("essential-reason")).toBeNull();
    expect(rows[0].querySelector('[data-priority="essential"]')).toBeTruthy();
    expect(screen.getByTestId("line-items-scroll").className).toMatch(/\brelative\b/); // keeps sr-only text clipped
    expect(rows[0].className).toContain("min-w-[14rem]");
  });
});

const listRow = (o: object) => ({ id: "1", requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-06T21:03:14Z", requester_name: "TEST Requester", needed_by: "2026-10-13", estimated_total: 1, status: "closed", is_demo: false, assigned_reviewer_id: "u1", departments: { name: "Production Team" }, department_subcategories: { name: "Audio Production" }, request_types: { name: "Order" }, highest_item_priority: "essential", essential_item_count: 1, ...o });

describe("requisition list priority", () => {
  it("table: wrapping indicator, all values present, relative scroll box", () => {
    render(<RequisitionTable currency="USD" timezone="America/New_York" reviewerName={() => "Ayodeji Ejidiran"} rows={[listRow({}), listRow({ id: "2", highest_item_priority: "low", essential_item_count: 0 })] as never} />);
    const cells = screen.getAllByTestId("priority-cell");
    expect(cells[0].textContent).toContain("Contains Essential item");
    expect(cells[1].textContent).toContain("Highest priority");
    expect(cells[1].textContent).toContain("Low");
    expect(cells[0].firstElementChild!.className).toContain("flex-wrap");
    expect(screen.getByTestId("requisition-table-scroll").className).toMatch(/\brelative\b.*overflow-x-auto|overflow-x-auto.*\brelative\b/);
    expect(screen.getAllByText(/Production Team · Audio Production/)).toHaveLength(2); // subcategory kept, not dropped
    expect(screen.getAllByText("Reviewer:", { exact: false }).length).toBe(2); // screen-reader label for reviewer
  });

  it("cards: priority shown for every level, text wraps instead of truncating", () => {
    render(<RequisitionCards currency="USD" rows={[listRow({}), listRow({ id: "2", highest_item_priority: "medium", essential_item_count: 0 })] as never} />);
    expect(document.querySelectorAll("[data-priority]").length).toBe(2);
    expect(document.querySelector(".truncate")).toBeNull();
  });
});
