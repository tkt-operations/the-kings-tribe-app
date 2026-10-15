// @vitest-environment jsdom
/**
 * Requisition amendments (Phase 1) in the UI: the amendment form (reason
 * required, review summary with before/after values and the revised total,
 * no delete control), line markers and the amendment history.
 */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { AmendmentRow, RequisitionItem } from "@/lib/data/requisition-detail";
import type { ProductLookupResponse } from "@/lib/product/types";

const amendRequisition = vi.fn<(id: string, input: unknown) => Promise<ActionResult<{ revision: number }>>>();
vi.mock("@/app/(app)/requisitions/[id]/actions", () => ({
  amendRequisition: (id: string, input: unknown) => amendRequisition(id, input),
}));
const getAmendmentProductDetails = vi.fn<(id: string, url: string) => Promise<ActionResult<ProductLookupResponse>>>();
vi.mock("@/app/(app)/requisitions/[id]/product-actions", () => ({
  getAmendmentProductDetails: (id: string, url: string) => getAmendmentProductDetails(id, url),
}));

const { AmendDialog } = await import("@/app/(app)/requisitions/[id]/amend-dialog");
const { AmendmentHistory } = await import("@/app/(app)/requisitions/[id]/amendment-history");
const { LineItemsTable } = await import("@/app/(app)/requisitions/[id]/line-items-table");

const REQ = "00000000-0000-4000-8000-0000000000aa";
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const blank = { essential_justification: "", vendor_name: "", vendor_url: "", requested_brand: "", requested_model: "", requested_sku: "", specifications: "", color: "", size: "", notes: "" };
const lines = [
  { ...blank, id: L1, line: 1, linkLocked: false, description: "Coffee beans", quantity: "3", estimated_unit_price: "19.99", priority: "medium" as const },
  { ...blank, id: L2, line: 2, linkLocked: true, description: "Paper cups", quantity: "2.5", estimated_unit_price: "10.01", priority: "low" as const, vendor_url: "https://shop.example.com/cups" },
];

function openDialog() {
  render(<ToastProvider><AmendDialog requisitionId={REQ} lines={lines} currency="USD" estimatedTotal="85.00" /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Amend requisition/ }));
  return screen.getByRole("dialog");
}
const fieldset = (dialog: HTMLElement, legend: RegExp) =>
  within(dialog).getAllByRole("group").find((g) => legend.test(g.querySelector("legend")?.textContent ?? ""))!;

beforeEach(() => {
  getAmendmentProductDetails.mockReset();
  amendRequisition.mockReset();
  amendRequisition.mockResolvedValue({ ok: true, data: { revision: 2 }, message: "Amendment saved as revision 2." });
});

describe("amendment form", () => {
  it("has no delete control, only “Remove from requisition”", () => {
    const d = openDialog();
    expect(within(d).queryByRole("button", { name: /delete/i })).toBeNull();
    expect(within(d).getAllByRole("button", { name: "Remove from requisition" })).toHaveLength(2);
  });

  it("requires a reason and at least one change before the review step", () => {
    const d = openDialog();
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));
    expect(within(d).getByText(/Make at least one change before reviewing/)).toBeTruthy();
    fireEvent.change(within(fieldset(d, /Line 1/)).getByLabelText(/Quantity/), { target: { value: "5" } });
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));
    expect(within(d).getByText(/Explain the reason for this amendment \(at least 10 characters\)/)).toBeTruthy();
    expect(amendRequisition).not.toHaveBeenCalled();
  });

  it("shows a review summary (old → new, removed, new, revised total) and submits exactly those changes", async () => {
    const d = openDialog();
    fireEvent.change(within(fieldset(d, /Line 1/)).getByLabelText(/Quantity/), { target: { value: "5" } });
    fireEvent.click(within(fieldset(d, /Line 2/)).getByRole("button", { name: "Remove from requisition" }));
    fireEvent.change(within(fieldset(d, /Line 2/)).getByLabelText(/Reason for removing/), { target: { value: "Already in stock" } });
    fireEvent.click(within(d).getByRole("button", { name: "Add line item" }));
    const added = fieldset(d, /New line/);
    fireEvent.change(within(added).getByLabelText(/Description/), { target: { value: "Sugar sachets" } });
    fireEvent.change(within(added).getByLabelText(/Unit price/), { target: { value: "3.50" } });
    fireEvent.change(within(d).getByLabelText(/Reason for this amendment/), { target: { value: "Requester called with corrections." } });
    expect(within(d).getByText(/\$103\.45/)).toBeTruthy(); // live revised total: 5 × 19.99 + 3.50
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));

    const summary = within(d).getByRole("list", { name: "Changes in this amendment" });
    expect(within(summary).getByText("Changed")).toBeTruthy();
    expect(within(summary).getByText("3")).toBeTruthy();
    expect(within(summary).getByText("5")).toBeTruthy();
    expect(within(summary).getByText("Removed")).toBeTruthy();
    expect(within(summary).getByText(/Reason: Already in stock/)).toBeTruthy();
    expect(within(summary).getByText("New")).toBeTruthy();
    expect(within(d).getByText("$85.00")).toBeTruthy();
    expect(within(d).getByText("$103.45")).toBeTruthy();

    fireEvent.click(within(d).getByRole("button", { name: "Submit amendment" }));
    await waitFor(() => expect(amendRequisition).toHaveBeenCalledTimes(1));
    expect(amendRequisition).toHaveBeenCalledWith(REQ, {
      reason: "Requester called with corrections.",
      changes: [
        { op: "update", item_id: L1, fields: { quantity: "5" } },
        { op: "remove", item_id: L2, reason: "Already in stock" },
        { op: "add", fields: { ...blank, description: "Sugar sachets", quantity: "1", estimated_unit_price: "3.50", priority: "medium" } },
      ],
    });
  });

  it("validates edited and new lines like the request form", () => {
    const d = openDialog();
    fireEvent.change(within(fieldset(d, /Line 1/)).getByLabelText(/Priority/), { target: { value: "essential" } });
    fireEvent.click(within(d).getByRole("button", { name: "Add line item" }));
    fireEvent.change(within(d).getByLabelText(/Reason for this amendment/), { target: { value: "Requester called with corrections." } });
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));
    expect(within(d).getByText(/Explain why this item is essential/)).toBeTruthy();
    expect(within(d).getByText(/Describe the item/)).toBeTruthy();
    expect(within(d).getByText(/Enter an amount like 24\.99/)).toBeTruthy();
  });

  it("a product link verified at submission is read-only", () => {
    const d = openDialog();
    expect((within(fieldset(d, /Line 2/)).getByLabelText(/Product link/) as HTMLInputElement).readOnly).toBe(true);
    expect((within(fieldset(d, /Line 1/)).getByLabelText(/Product link/) as HTMLInputElement).readOnly).toBe(false);
  });
});

describe("line markers", () => {
  const item = (over: Partial<RequisitionItem>): RequisitionItem => ({
    id: L1, line_number: 1, description: "Coffee beans", specifications: null, color: null, size: null, quantity: "3.00", estimated_unit_price: "19.99",
    estimated_total: "59.97", vendor_name: null, vendor_url: null, notes: null, review_status: "pending", approved_quantity: null, approved_unit_price: null,
    approved_total: "0.00", review_comment: null, po_quantity: "0.00", ordered_quantity: "0.00", purchased_quantity: "0.00", actual_total: "0.00",
    cancelled_quantity: "0.00", cancel_reason: null, priority: "medium", essential_justification: null,
    added_in_revision: 1, last_changed_revision: null, removed_at: null, removed_reason: null, ...over,
  });

  it("marks NEW, CHANGED and REMOVED lines; untouched lines get no marker; removed lines stay visible", () => {
    render(<LineItemsTable currency="USD" items={[
      item({}),
      item({ id: L2, line_number: 2, description: "Cups", last_changed_revision: 2 }),
      item({ id: "00000000-0000-4000-8000-000000000003", line_number: 3, description: "Lids", removed_at: "2026-10-14T10:00:00Z", removed_reason: "In stock", last_changed_revision: 3 }),
      item({ id: "00000000-0000-4000-8000-000000000004", line_number: 4, description: "Sugar", added_in_revision: 2, last_changed_revision: null }),
    ]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).queryByText(/New|Changed|Removed/)).toBeNull();
    expect(within(rows[1]).getByText("Changed · rev 2")).toBeTruthy();
    expect(within(rows[2]).getByText("Removed · rev 3")).toBeTruthy();
    expect(within(rows[2]).getByText("Removed: In stock")).toBeTruthy();
    expect(rows[2].getAttribute("data-removed")).toBe("true");
    expect(within(rows[3]).getByText("New · rev 2")).toBeTruthy();
  });
});

describe("amendment history", () => {
  const amendments: AmendmentRow[] = [
    { id: "a3", revision_number: 3, actor_id: "u1", actor_label: null, reason: "Lids were already in stock.", status_at_amendment: "under_review",
      estimated_total_before: "92.00", estimated_total_after: "86.00", submitted_at: "2026-10-14T15:00:00Z",
      changes: [{ id: "c3", requisition_item_id: "i3", line_number: 3, change_type: "removed", field: null,
        old_value: { description: "Lids", quantity: 1 }, new_value: { removed_reason: "In stock" }, previous_review: null }] },
    { id: "a2", revision_number: 2, actor_id: "u1", actor_label: null, reason: "Requester called to correct the order.", status_at_amendment: "on_hold",
      estimated_total_before: "85.00", estimated_total_after: "92.00", submitted_at: "2026-10-14T14:00:00Z",
      changes: [
        { id: "c1", requisition_item_id: "i1", line_number: 1, change_type: "updated", field: "quantity", old_value: 3, new_value: 5,
          previous_review: { review_status: "held", review_comment: "Find a cheaper roaster" } },
        { id: "c2", requisition_item_id: "i4", line_number: 4, change_type: "added", field: null, old_value: null,
          new_value: { description: "Sugar", quantity: 2, estimated_unit_price: 3.5 }, previous_review: null },
      ] },
  ];

  it("lists revisions newest first with actor, reason, totals and line-by-line changes", () => {
    render(<AmendmentHistory amendments={amendments} currency="USD" timezone="America/Chicago" name={() => "Harper Head"} />);
    const items = screen.getAllByTestId("amendment");
    expect(within(items[0]).getByText("Revision 3")).toBeTruthy();
    expect(within(items[1]).getByText("Revision 2")).toBeTruthy();
    expect(within(items[1]).getByText(/Harper Head · Oct 14, 2026/)).toBeTruthy();
    expect(within(items[1]).getByText("Requester called to correct the order.")).toBeTruthy();
    expect(within(items[1]).getByText("$85.00 → $92.00", { exact: false })).toBeTruthy();
    expect(within(items[1]).getByText("Changed")).toBeTruthy();
    expect(within(items[1]).getByText(/Earlier decision \(held: Find a cheaper roaster\) cleared/)).toBeTruthy();
    expect(within(items[1]).getByText("New")).toBeTruthy();
    expect(within(items[0]).getByText("Removed")).toBeTruthy();
    expect(within(items[0]).getByText("Reason: In stock")).toBeTruthy();
  });

  it("renders nothing for a requisition that was never amended", () => {
    const { container } = render(<AmendmentHistory amendments={[]} currency="USD" timezone="UTC" name={() => null} />);
    expect(container.textContent).toBe("");
  });
});


describe("product link auto-fill in amendments (shared with the request form)", () => {
  const GC = "https://www.guitarcenter.com/Fender/Player-II-Stratocaster-1500000390193.gc";
  const found: ProductLookupResponse = {
    outcome: "full", domain: "guitarcenter.com", method: "structured_data", priceNote: null, token: "ignored-token", currency: "USD", price: "849.99",
    fields: { title: "Fender Player II Stratocaster", vendor_name: "Guitar Center", sku: "1500000390193", brand: "Fender" },
  };
  const newLine = (d: HTMLElement) => { fireEvent.click(within(d).getByRole("button", { name: "Add line item" })); return fieldset(d, /New line/); };
  const lookup = async (g: HTMLElement, url = GC) => {
    fireEvent.change(within(g).getByLabelText(/Product link/), { target: { value: url } });
    fireEvent.click(within(g).getByRole("button", { name: "Get details" }));
  };

  it("Add new line: Get details fills description, vendor, price, SKU and brand; values stay editable", async () => {
    getAmendmentProductDetails.mockResolvedValue({ ok: true, data: found });
    const d = openDialog();
    const g = newLine(d);
    await lookup(g);
    await waitFor(() => expect((within(g).getByLabelText(/Description/) as HTMLInputElement).value).toBe("Fender Player II Stratocaster"));
    expect(getAmendmentProductDetails).toHaveBeenCalledWith(REQ, GC);
    expect((within(g).getByLabelText(/^Vendor/) as HTMLInputElement).value).toBe("Guitar Center");
    expect((within(g).getByLabelText(/Unit price/) as HTMLInputElement).value).toBe("849.99");
    expect((within(g).getByLabelText(/SKU/) as HTMLInputElement).value).toBe("1500000390193");
    expect((within(g).getByLabelText(/Brand/) as HTMLInputElement).value).toBe("Fender");
    expect(within(g).getAllByText("Filled").length).toBeGreaterThan(0);
    fireEvent.change(within(g).getByLabelText(/Unit price/), { target: { value: "799.99" } });
    expect((within(g).getByLabelText(/Unit price/) as HTMLInputElement).value).toBe("799.99");
    expect(within(g).getByText("Edited")).toBeTruthy();
  });

  it("never overwrites what was typed: a 'Use fetched value' suggestion appears instead", async () => {
    getAmendmentProductDetails.mockResolvedValue({ ok: true, data: found });
    const d = openDialog();
    const g = newLine(d);
    fireEvent.change(within(g).getByLabelText(/Description/), { target: { value: "Strat for the youth band" } });
    await lookup(g);
    await waitFor(() => expect((within(g).getByLabelText(/SKU/) as HTMLInputElement).value).toBe("1500000390193"));
    expect((within(g).getByLabelText(/Description/) as HTMLInputElement).value).toBe("Strat for the youth band");
    expect(within(g).getByRole("button", { name: /Use fetched value: Fender Player II Stratocaster/ })).toBeTruthy();
  });

  it("changing the link clears only untouched auto-filled values; edited ones are kept", async () => {
    getAmendmentProductDetails.mockResolvedValue({ ok: true, data: found });
    const d = openDialog();
    const g = newLine(d);
    await lookup(g);
    await waitFor(() => expect((within(g).getByLabelText(/SKU/) as HTMLInputElement).value).toBe("1500000390193"));
    fireEvent.change(within(g).getByLabelText(/Unit price/), { target: { value: "799.99" } }); // edited: kept
    fireEvent.change(within(g).getByLabelText(/Product link/), { target: { value: "https://www.example.com/other-product" } });
    fireEvent.blur(within(g).getByLabelText(/Product link/));
    await waitFor(() => expect((within(g).getByLabelText(/Description/) as HTMLInputElement).value).toBe(""));
    expect((within(g).getByLabelText(/SKU/) as HTMLInputElement).value).toBe("");
    expect((within(g).getByLabelText(/^Vendor/) as HTMLInputElement).value).toBe("");
    expect((within(g).getByLabelText(/Unit price/) as HTMLInputElement).value).toBe("799.99");
    expect(within(g).getByText(/details filled from the previous product were cleared/)).toBeTruthy();
  });

  it("a failed lookup falls back to manual entry and never blocks the amendment", async () => {
    getAmendmentProductDetails.mockResolvedValue({ ok: false, error: "Too many lookups right now. Please complete the details below." });
    const d = openDialog();
    const g = newLine(d);
    await lookup(g, "https://www.example.com/blocked");
    expect(await within(g).findByText(/Too many lookups right now/)).toBeTruthy();
    fireEvent.change(within(g).getByLabelText(/Description/), { target: { value: "Spare cable" } });
    fireEvent.change(within(g).getByLabelText(/Unit price/), { target: { value: "12" } });
    fireEvent.change(within(d).getByLabelText(/Reason for this amendment/), { target: { value: "Requester added a spare cable." } });
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));
    fireEvent.click(within(d).getByRole("button", { name: "Submit amendment" }));
    await waitFor(() => expect(amendRequisition).toHaveBeenCalledTimes(1));
    expect((amendRequisition.mock.calls[0][1] as { changes: { op: string; fields: Record<string, string> }[] }).changes[0])
      .toMatchObject({ op: "add", fields: { description: "Spare cable", estimated_unit_price: "12", vendor_url: "https://www.example.com/blocked" } });
  });

  it("Edit existing line: the same lookup fills empty fields, and the changes show in the amendment diff", async () => {
    getAmendmentProductDetails.mockResolvedValue({ ok: true, data: found });
    const d = openDialog();
    const g = fieldset(d, /Line 1/);
    await lookup(g);
    await waitFor(() => expect((within(g).getByLabelText(/SKU/) as HTMLInputElement).value).toBe("1500000390193"));
    expect((within(g).getByLabelText(/Description/) as HTMLInputElement).value).toBe("Coffee beans"); // already set: kept
    fireEvent.change(within(d).getByLabelText(/Reason for this amendment/), { target: { value: "Requester sent the exact product link." } });
    fireEvent.click(within(d).getByRole("button", { name: "Review changes" }));
    const summary = within(d).getByRole("list", { name: "Changes in this amendment" });
    expect(within(summary).getByText(/SKU \/ product number:/)).toBeTruthy();
    expect(within(summary).getByText("1500000390193")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Submit amendment" }));
    await waitFor(() => expect(amendRequisition).toHaveBeenCalledTimes(1));
    expect((amendRequisition.mock.calls[0][1] as { changes: unknown[] }).changes[0]).toEqual({
      op: "update", item_id: L1,
      fields: { vendor_name: "Guitar Center", vendor_url: GC, requested_brand: "Fender", requested_sku: "1500000390193" },
    });
  });

  it("a verified product link stays locked: no Get details on that line", () => {
    const d = openDialog();
    expect(within(fieldset(d, /Line 2/)).queryByRole("button", { name: "Get details" })).toBeNull();
    expect(within(fieldset(d, /Line 1/)).getByRole("button", { name: "Get details" })).toBeTruthy();
  });
});
