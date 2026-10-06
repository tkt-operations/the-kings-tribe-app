// @vitest-environment jsdom
/** A representative workflow dialog: Record disbursement. */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";

const recordDisbursement = vi.fn<(id: string, input: unknown) => Promise<ActionResult>>();
vi.mock("@/app/(app)/requisitions/[id]/actions", () => ({ recordDisbursement: (id: string, input: unknown) => recordDisbursement(id, input) }));

const { DisbursementDialog } = await import("@/app/(app)/requisitions/[id]/disbursement-dialog");

async function open() {
  render(<ToastProvider><DisbursementDialog requisitionId="00000000-0000-4000-8000-000000000001" remaining="$150.00" workflow="reimbursement" /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Record reimbursement/ }));
  return screen.getByLabelText(/^Amount/);
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const toastAlert = () => screen.getAllByRole("alert").find((el) => el.getAttribute("aria-live") === "assertive")!;

beforeEach(() => {
  recordDisbursement.mockReset();
});

describe("disbursement dialog", () => {
  it("marks required fields", async () => {
    await open();
    expect(screen.getByText("Required fields")).toBeTruthy();
    expect(screen.getByLabelText(/^Amount/).getAttribute("aria-required")).toBe("true");
    expect(screen.getByLabelText(/^Date paid/).getAttribute("aria-required")).toBe("true");
    expect(screen.getByLabelText(/Check # \/ reference/).hasAttribute("aria-required")).toBe(false);
  });

  it("requires an amount and focuses it", async () => {
    const amount = await open();
    save();
    expect(await screen.findByText("Amount is required.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(recordDisbursement).not.toHaveBeenCalled();
  });

  it("rejects a zero amount", async () => {
    const user = userEvent.setup();
    const amount = await open();
    await user.type(amount, "0");
    save();
    expect(await screen.findByText("Enter an amount greater than $0.")).toBeTruthy();
    expect(amount.getAttribute("aria-invalid")).toBe("true");
  });

  it("toasts success and closes", async () => {
    const user = userEvent.setup();
    recordDisbursement.mockResolvedValue({ ok: true, data: undefined, message: "Disbursement recorded successfully." });
    await user.type(await open(), "45.00");
    save();
    expect(await within(screen.getByRole("status")).findByText("Disbursement recorded successfully.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(/^Amount/)).toBeNull());
  });

  it("toasts failure, shows the form-level error, and keeps the values", async () => {
    const user = userEvent.setup();
    recordDisbursement.mockResolvedValue({ ok: false, error: "The amount is more than what remains approved." });
    const amount = await open();
    await user.type(amount, "500");
    await user.type(screen.getByLabelText(/Check # \/ reference/), "CHK-1042");
    save();
    expect(await within(toastAlert()).findByText("The amount is more than what remains approved.")).toBeTruthy();
    expect(screen.getAllByText("The amount is more than what remains approved.").length).toBeGreaterThanOrEqual(2); // toast + inline alert
    expect((screen.getByLabelText(/^Amount/) as HTMLInputElement).value).toBe("500");
    expect((screen.getByLabelText(/Check # \/ reference/) as HTMLInputElement).value).toBe("CHK-1042");
  });
});
