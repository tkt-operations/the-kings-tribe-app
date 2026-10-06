// @vitest-environment jsdom
/** Finance sees priorities; priority never decides; priority changes give feedback. */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriorityBadge, PriorityIndicator } from "@/components/ui/priority-badge";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { ItemModel } from "@/app/(app)/requisitions/[id]/types";

const reviewRequisition = vi.fn<(id: string, input: unknown) => Promise<ActionResult>>();
const updateItemPriority = vi.fn<(id: string, itemId: string, input: unknown) => Promise<ActionResult>>();
vi.mock("@/app/(app)/requisitions/[id]/actions", () => ({
  reviewRequisition: (id: string, input: unknown) => reviewRequisition(id, input),
  updateItemPriority: (id: string, itemId: string, input: unknown) => updateItemPriority(id, itemId, input),
}));

const { ReviewDialog } = await import("@/app/(app)/requisitions/[id]/review-dialog");
const { PriorityEditor } = await import("@/app/(app)/requisitions/[id]/priority-editor");

const REQ = "00000000-0000-4000-8000-0000000000aa";
const base: Omit<ItemModel, "id" | "line" | "description" | "priority" | "essentialJustification"> = {
  quantity: "2.00", estimatedUnitPrice: "600.00", reviewStatus: "pending", approvedQuantity: null, approvedUnitPrice: null, approvedTotal: "0.00",
  poQuantity: "0.00", orderedQuantity: "0.00", purchasedQuantity: "0.00", cancelledQuantity: "0.00", actualTotal: "0.00", reviewComment: null, vendorName: null,
};
const items: ItemModel[] = [
  { ...base, id: "00000000-0000-4000-8000-000000000001", line: 1, description: "Wireless microphone system", priority: "essential", essentialJustification: "Required to replace failed equipment before Sunday service." },
  { ...base, id: "00000000-0000-4000-8000-000000000002", line: 2, description: "Mic clips", priority: "high", essentialJustification: null },
  { ...base, id: "00000000-0000-4000-8000-000000000003", line: 3, description: "XLR cables", quantity: "4.00", estimatedUnitPrice: "40.00", priority: "low", essentialJustification: null },
];

beforeEach(() => {
  reviewRequisition.mockReset();
  updateItemPriority.mockReset();
});

function openReview() {
  render(
    <ToastProvider>
      <ReviewDialog requisitionId={REQ} items={items} currency="USD" costCenters={[]} expenseCategories={[]} currentCostCenterId={null} currentExpenseCategoryId={null} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Review/ }));
}

describe("Finance review shows priority", () => {
  it("shows each line's priority and the Essential reason", () => {
    openReview();
    const dialog = screen.getByRole("dialog");
    const badges = Array.from(dialog.querySelectorAll("[data-priority]")).map((b) => b.getAttribute("data-priority"));
    expect(badges).toEqual(["essential", "high", "low"]);
    expect(within(dialog).getByText("Required to replace failed equipment before Sunday service.")).toBeTruthy();
  });

  it("does not auto-approve: Essential and High lines can be rejected or held", async () => {
    reviewRequisition.mockResolvedValue({ ok: true, data: undefined, message: "Requisition partially approved successfully." });
    openReview();
    fireEvent.click(screen.getByRole("radio", { name: /Partially approve/ }));
    fireEvent.change(screen.getByLabelText(/Decision for line 1/), { target: { value: "rejected" } });
    fireEvent.change(screen.getByLabelText(/Reason for line 1/), { target: { value: "Borrow from youth ministry" } });
    fireEvent.change(screen.getByLabelText(/Decision for line 2/), { target: { value: "held" } });
    fireEvent.change(screen.getByLabelText(/Reason for line 2/), { target: { value: "Waiting on a quote" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(reviewRequisition).toHaveBeenCalledTimes(1));
    const input = reviewRequisition.mock.calls[0][1] as { decision: string; items: { item_id: string; decision: string }[] };
    expect(input.decision).toBe("partial");
    expect(input.items.map((i) => i.decision)).toEqual(["rejected", "held", "approved"]);
    expect(await screen.findByText("Requisition partially approved successfully.")).toBeTruthy();
  });

  it("does not pre-select anything special for Essential lines", () => {
    openReview();
    fireEvent.click(screen.getByRole("radio", { name: /Partially approve/ }));
    // Every line starts on the same default; priority doesn't change it.
    expect(["1", "2", "3"].map((n) => (screen.getByLabelText(new RegExp(`Decision for line ${n}`)) as HTMLSelectElement).value)).toEqual(["approved", "approved", "approved"]);
  });
});

describe("changing an item's priority", () => {
  const renderEditor = () =>
    render(
      <ToastProvider>
        <PriorityEditor requisitionId={REQ} item={{ id: items[2].id, line: 3, description: "XLR cables", priority: "low", essentialJustification: null }} />
      </ToastProvider>,
    );

  it("requires a reason for Essential, inline", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /Change priority for line 3/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Essential$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save priority" }));
    expect(await screen.findByText("Explain why this item is essential.")).toBeTruthy();
    expect(updateItemPriority).not.toHaveBeenCalled();
  });

  it("shows 'Item priority updated successfully.'", async () => {
    updateItemPriority.mockResolvedValue({ ok: true, data: undefined, message: "Item priority updated successfully." });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /Change priority for line 3/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^High$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save priority" }));
    await waitFor(() => expect(updateItemPriority).toHaveBeenCalled());
    expect(await within(screen.getByRole("status")).findByText("Item priority updated successfully.")).toBeTruthy();
    expect(updateItemPriority.mock.calls[0][2]).toMatchObject({ priority: "high" });
  });

  it("shows 'Unable to update item priority. Please try again.' on unexpected failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    updateItemPriority.mockRejectedValue(new Error("network down"));
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /Change priority for line 3/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Medium$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save priority" }));
    expect(await screen.findAllByText("Unable to update item priority. Please try again.")).not.toHaveLength(0);
    consoleError.mockRestore();
  });
});

describe("priority badges are accessible", () => {
  it("use words and an icon, not colour alone", () => {
    render(<div>{(["essential", "high", "medium", "low"] as const).map((p) => <PriorityBadge key={p} priority={p} />)}</div>);
    for (const label of ["Essential", "High", "Medium", "Low"]) {
      const badge = screen.getByText(label).closest("[data-priority]")!;
      expect(badge.textContent).toBe(`Priority: ${label}`);
      expect(badge.querySelector("svg[aria-hidden]")).toBeTruthy();
    }
    expect(document.querySelector('[data-priority="essential"]')!.className).toContain("uppercase");
  });

  it("summarise a requisition from its items", () => {
    const { rerender } = render(<PriorityIndicator highest="essential" essentialCount={1} />);
    expect(screen.getByText("Contains Essential item")).toBeTruthy();
    rerender(<PriorityIndicator highest="essential" essentialCount={3} />);
    expect(screen.getByText("3 Essential items")).toBeTruthy();
    rerender(<PriorityIndicator highest="high" essentialCount={0} />);
    expect(screen.getByText("Highest priority")).toBeTruthy();
  });
});
