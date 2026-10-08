// @vitest-environment jsdom
/** Line-item priority on the public requisition form. */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { previewFormContext } from "@/app/dev-preview/fixtures";
import type { ActionResult } from "@/lib/action-result";

const submitExternalRequisition = vi.fn<(...args: unknown[]) => Promise<ActionResult<unknown>>>();
vi.mock("@/app/request/[token]/actions", () => ({
  submitExternalRequisition: (...args: unknown[]) => submitExternalRequisition(...args),
  prepareReceiptUploads: vi.fn(),
}));
vi.mock("@/app/request/[token]/product-actions", () => ({ getProductDetails: vi.fn() }));

const { RequisitionForm } = await import("@/app/request/[token]/requisition-form");

const ctx = previewFormContext;
const renderForm = () => render(<ToastProvider><RequisitionForm token={"t".repeat(48)} context={ctx} stamp="stamp" /></ToastProvider>);
const group = (line: number) => document.getElementById(`items.${line}.priority`) as HTMLFieldSetElement;
const radio = (line: number, label: string) => within(group(line)).getByRole("radio", { name: new RegExp(`^${label}$`, "i") }) as HTMLInputElement;
const change = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });

function fillValid() {
  change("requester_name", "Jordan Example");
  change("requester_email", "jordan@example.org");
  change("requester_phone", "(555) 010-2000");
  change("department_head_name", "Jordan Example");
  change("department_id", ctx.departments[0].id);
  change("subcategory_id", ctx.departments[0].subcategories[0].id);
  change("needed_by", "2026-10-12");
  fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
  change("items.0.description", "Wireless microphone system");
  change("items.0.quantity", "2");
  change("items.0.estimated_unit_price", "600");
  change("justification", "Equipment for Sunday production and the live stream.");
  fireEvent.click(document.getElementById("certification_accepted")!);
  change("certification_name", "Jordan Example");
}

beforeEach(() => {
  submitExternalRequisition.mockReset();
});

describe("requisition form priority", () => {
  it("defaults each line to Medium and marks priority as required", () => {
    renderForm();
    expect(radio(0, "Medium").checked).toBe(true);
    const g = group(0);
    expect(g.getAttribute("role")).toBe("radiogroup");
    expect(g.getAttribute("aria-required")).toBe("true");
    expect(within(g).getByText("*")).toBeTruthy();
    // Selected level's meaning is shown under the chips (and again in the "What do the priorities mean?" list).
    expect(within(document.getElementById("items.0.priority-help")!).getByText((_, el) => el?.tagName === "P" && /Medium:\s*Needed, but can follow/.test(el.textContent ?? ""))).toBeTruthy();
  });

  it("is mobile friendly: large 2-column chips on phones, one row on wider screens", () => {
    renderForm();
    const grid = group(0).querySelector("div.grid")!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-4");
    expect(radio(0, "Essential").closest("label")!.className).toContain("min-h-12");
  });

  it("lets the requester choose Essential, High, Medium or Low", () => {
    renderForm();
    for (const p of ["Essential", "High", "Low", "Medium"]) {
      fireEvent.click(radio(0, p));
      expect(radio(0, p).checked).toBe(true);
    }
  });

  it("requires a justification only for Essential", () => {
    renderForm();
    expect(screen.queryByLabelText(/Why is this item essential/)).toBeNull();
    fireEvent.click(radio(0, "High"));
    expect(screen.queryByLabelText(/Why is this item essential/)).toBeNull();
    fireEvent.click(radio(0, "Essential"));
    const reason = screen.getByLabelText(/Why is this item essential/);
    expect(reason.getAttribute("aria-required")).toBe("true");
    expect(screen.getByText("Briefly explain the operational impact if this item is not purchased.")).toBeTruthy();
  });

  it("gives every added line its own independent priority", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    expect(radio(1, "Medium").checked).toBe(true);
    fireEvent.click(radio(0, "Essential"));
    fireEvent.click(radio(2, "Low"));
    expect([radio(0, "Essential").checked, radio(1, "Medium").checked, radio(2, "Low").checked]).toEqual([true, true, true]);
    expect(screen.getAllByLabelText(/Why is this item essential/)).toHaveLength(1);
  });

  it("blocks submission of an Essential line without a justification, inline at that line", async () => {
    renderForm();
    fillValid();
    fireEvent.click(radio(0, "Essential"));
    fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
    expect(await screen.findByText("Explain why this item is essential")).toBeTruthy();
    expect(screen.getByLabelText(/Why is this item essential/).getAttribute("aria-invalid")).toBe("true");
    expect(submitExternalRequisition).not.toHaveBeenCalled();
  });

  it("sends each line's priority and keeps priorities when submission fails", async () => {
    submitExternalRequisition.mockResolvedValue({ ok: false, error: "Unable to submit requisition. Please try again." });
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    change("items.1.description", "XLR cables");
    change("items.1.quantity", "4");
    change("items.1.estimated_unit_price", "40");
    fireEvent.click(radio(0, "Essential"));
    change("items.0.essential_justification", "Required to replace failed equipment before Sunday service.");
    fireEvent.click(radio(1, "Low"));
    fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
    await waitFor(() => expect(submitExternalRequisition).toHaveBeenCalledTimes(1));
    const values = submitExternalRequisition.mock.calls[0][1] as { items: { priority: string; essential_justification: string }[] };
    expect(values.items.map((i) => i.priority)).toEqual(["essential", "low"]);
    expect(values.items[0].essential_justification).toBe("Required to replace failed equipment before Sunday service.");
    expect(await screen.findByText("Your request was not submitted")).toBeTruthy();
    expect(radio(0, "Essential").checked).toBe(true);
    expect(radio(1, "Low").checked).toBe(true);
    expect((screen.getByLabelText(/Why is this item essential/) as HTMLTextAreaElement).value).toBe("Required to replace failed equipment before Sunday service.");
  });

  it("shows priorities on the confirmation and a success toast", async () => {
    submitExternalRequisition.mockResolvedValue({
      ok: true,
      data: {
        requisition_number: "TKT-REQ-2026-0001", submitted_at: "2026-10-05T15:00:00Z", needed_by: "2026-10-12",
        department_name: "Production Team", subcategory_name: "Audio Production", request_type_name: "Order", estimated_total: "1360.00", status: "submitted",
        items: [
          { line_number: 1, description: "XLR cables", quantity: "4.00", estimated_total: "160.00", priority: "medium", essential_justification: null },
          { line_number: 2, description: "Wireless microphone system", quantity: "2.00", estimated_total: "1200.00", priority: "essential", essential_justification: "Failed before Sunday." },
        ],
      },
    });
    window.scrollTo = vi.fn();
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
    expect(await screen.findByText("Requisition TKT-REQ-2026-0001 submitted successfully.")).toBeTruthy();
    expect(screen.getByText(/includes 1 Essential item/)).toBeTruthy();
    const list = screen.getByText("Wireless microphone system × 2").closest("ul")!;
    // Essential listed first; badges carry words for screen readers too.
    expect(Array.from(list.querySelectorAll("[data-priority]")).map((n) => n.textContent)).toEqual(["Priority: Essential", "Priority: Medium"]);
  });

  it("dates the confirmation in the church timezone, not UTC (evening submission)", async () => {
    // 10:30 PM Central on Monday Oct 5 is already Tuesday Oct 6 in UTC.
    expect(ctx.timezone).toBe("America/Chicago");
    submitExternalRequisition.mockResolvedValue({
      ok: true,
      data: {
        requisition_number: "TKT-REQ-2026-0002", submitted_at: "2026-10-06T03:30:00Z", needed_by: "2026-10-12",
        department_name: "Production Team", subcategory_name: "Audio Production", request_type_name: "Order", estimated_total: "160.00", status: "submitted",
        items: [{ line_number: 1, description: "XLR cables", quantity: "4.00", estimated_total: "160.00", priority: "medium", essential_justification: null }],
      },
    });
    window.scrollTo = vi.fn();
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
    expect(await screen.findByText("Monday, October 5, 2026")).toBeTruthy();
    expect(screen.queryByText("Tuesday, October 6, 2026")).toBeNull();
  });
});
