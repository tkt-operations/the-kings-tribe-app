// @vitest-environment jsdom
/** Setup wizard sidebar + step forms: checkmarks reflect saved state; saves refresh it. */
import { routerMock } from "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { computeSetupProgress, type SetupSnapshot } from "@/lib/setup/progress";
import type { ActionResult } from "@/lib/action-result";
import type { ChurchSettings } from "@/lib/data/settings";

const saveSettings = vi.fn<(input: Record<string, unknown>, options: unknown) => Promise<ActionResult>>();
vi.mock("@/app/(app)/admin/settings/actions", () => ({
  saveSettings: (input: Record<string, unknown>, options: unknown) => saveSettings(input, options),
  completeSetup: vi.fn(),
}));

const { SetupStepList } = await import("@/app/(app)/admin/setup/setup-step-list");
const { SettingsForm } = await import("@/app/(app)/admin/settings/settings-form");

const settings: ChurchSettings = {
  church_name: "The Kings Tribe", address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null,
  phone: null, email: null, website: null, currency_code: "USD", timezone: "America/Chicago", finance_notification_email: null,
  requisition_policy: "Submit purchase requests 3–7 days early.", po_instructions: "Present this Purchase Order to the vendor.",
  po_footer: "Authorizes only the listed items.", setup_completed_at: null,
};
const snapshot = (row: object): SetupSnapshot => ({
  settings: row as Record<string, unknown>, activeCategories: { attendance: 1, finance: 1, requisition: 1 }, departmentsReady: 1, activeUsers: 1, usableLinks: 0,
});
const sidebar = (row: object) => {
  const p = computeSetupProgress(snapshot(row));
  return <SetupStepList steps={p.steps} currentStep={1} completed={p.completed} total={p.total} />;
};
const icon = (n: number) => (screen.queryByTestId(`step-${n}-done`) ? "done" : screen.queryByTestId(`step-${n}-todo`) ? "todo" : "missing");

beforeEach(() => {
  saveSettings.mockReset();
});

describe("setup sidebar", () => {
  it("shows no checkmark for Step 1 until church information is saved; Steps 3 and 4 stay checked", () => {
    render(sidebar(settings));
    expect([1, 2, 3, 4, 5, 6].map(icon)).toEqual(["todo", "todo", "done", "done", "todo", "todo"]);
    expect(screen.getByText("2 of 6 steps complete")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Church information.*— not complete/ })).toBeTruthy();
  });

  it("shows the green checkmark for completed church information", () => {
    render(sidebar({ ...settings, address_line1: "100 Example Avenue", phone: "(555) 010-0000", email: "office@example.org" }));
    expect(icon(1)).toBe("done");
    expect(screen.getByRole("link", { name: /Church information\s*— complete/ })).toBeTruthy();
    expect(screen.getByText("3 of 6 steps complete")).toBeTruthy();
  });

  it("marks the team step optional", () => {
    render(sidebar(settings));
    expect(within(screen.getByRole("link", { name: /5\. Invite your team/ })).getByText("(optional)")).toBeTruthy();
  });
});

describe("Step 1 form", () => {
  const renderStep1 = () => render(<ToastProvider><SettingsForm settings={settings} timezones={["America/Chicago"]} sections={["church", "money"]} /></ToastProvider>);
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Address line 1/), { target: { value: "100 Example Avenue" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "(555) 010-0000" } });
    fireEvent.change(screen.getByLabelText(/Church email/), { target: { value: "office@example.org" } });
  };

  it("marks the fields that complete the step as required", () => {
    renderStep1();
    for (const l of [/Church name/, /Address line 1/, /^Phone/, /Church email/, /Currency/, /Timezone/]) {
      expect(screen.getByLabelText(l).getAttribute("aria-required")).toBe("true");
    }
    expect(screen.getByLabelText(/Address line 2/).hasAttribute("aria-required")).toBe(false);
  });

  it("blocks saving with missing required fields (step cannot become complete)", async () => {
    renderStep1();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Address line 1 is required.")).toBeTruthy();
    expect(screen.getByText("Phone is required.")).toBeTruthy();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("on success: saves only this step, toasts, and refreshes so the sidebar checkmark updates", async () => {
    saveSettings.mockResolvedValue({ ok: true, data: undefined, message: "Church information saved successfully." });
    renderStep1();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await within(screen.getByRole("status")).findByText("Church information saved successfully.")).toBeTruthy();
    expect(saveSettings.mock.calls[0][1]).toEqual({ sections: ["church", "money"], requireNotificationEmail: false });
    expect(routerMock.refresh).toHaveBeenCalled(); // server re-derives completion from the database
  });

  it("on failure: no refresh (no checkmark), a specific error, and the typed values stay", async () => {
    saveSettings.mockResolvedValue({ ok: false, error: "Church information could not be saved. Please try again." });
    renderStep1();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(screen.getAllByText("Church information could not be saved. Please try again.").length).toBeGreaterThanOrEqual(2));
    expect(routerMock.refresh).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Address line 1/) as HTMLInputElement).value).toBe("100 Example Avenue");
    expect(screen.queryByText("Something went wrong. Please try again.")).toBeNull();
  });
});

describe("Step 2 form", () => {
  it("requires the Finance notification email in the wizard", async () => {
    render(<ToastProvider><SettingsForm settings={settings} timezones={["America/Chicago"]} sections={["notifications", "policy"]} requireNotificationEmail /></ToastProvider>);
    expect(screen.getByLabelText(/Finance notification email/).getAttribute("aria-required")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Finance notification email is required.")).toBeTruthy();
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
