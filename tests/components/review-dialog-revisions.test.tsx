// @vitest-environment jsdom
/**
 * The review dialog copies the lines into its own state when it mounts. After
 * an amendment adds or removes a line, the page must give it a new key
 * (lineStateKey changes with the revision) — otherwise the refreshed page
 * crashed ("Cannot read properties of undefined (reading 'decision')").
 */
import "./setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { lineStateKey } from "@/lib/amendments";
import type { ItemModel } from "@/app/(app)/requisitions/[id]/types";

vi.mock("@/app/(app)/requisitions/[id]/actions", () => ({ reviewRequisition: vi.fn() }));
const { ReviewDialog } = await import("@/app/(app)/requisitions/[id]/review-dialog");

const base: Omit<ItemModel, "id" | "line" | "description"> = {
  quantity: "2.00", estimatedUnitPrice: "10.00", reviewStatus: "pending", approvedQuantity: null, approvedUnitPrice: null, approvedTotal: "0.00",
  poQuantity: "0.00", orderedQuantity: "0.00", purchasedQuantity: "0.00", cancelledQuantity: "0.00", actualTotal: "0.00", reviewComment: null,
  vendorName: null, priority: "medium", essentialJustification: null,
};
const item = (n: number): ItemModel => ({ ...base, id: `00000000-0000-4000-8000-00000000000${n}`, line: n, description: `Line ${n} item` });
const dialog = (key: string, items: ItemModel[]) => (
  <ToastProvider>
    <ReviewDialog key={key} requisitionId="00000000-0000-4000-8000-0000000000aa" items={items} currency="USD"
      costCenters={[]} expenseCategories={[]} currentCostCenterId={null} currentExpenseCategoryId={null} />
  </ToastProvider>
);

describe("review dialog after an amendment", () => {
  it("the key changes with every revision (and with status)", () => {
    expect(lineStateKey("rv", "submitted", 1)).not.toBe(lineStateKey("rv", "submitted", 2));
    expect(lineStateKey("rv", "submitted", 2)).not.toBe(lineStateKey("rv", "under_review", 2));
  });

  it("with the revision key, a line added by an amendment renders without crashing", () => {
    const view = render(dialog(lineStateKey("rv", "submitted", 1), [item(1), item(2)]));
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    view.rerender(dialog(lineStateKey("rv", "submitted", 2), [item(1), item(2), item(3)]));
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(screen.getByText(/Line 3 item/)).toBeTruthy();
  });

  it("documents the old failure: same key + an extra line crashes the page", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(dialog("rv-submitted", [item(1), item(2)]));
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(() => view.rerender(dialog("rv-submitted", [item(1), item(2), item(3)]))).toThrow(/reading 'decision'/);
  });
});
