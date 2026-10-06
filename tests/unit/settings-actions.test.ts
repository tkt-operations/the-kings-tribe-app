/** saveSettings / completeSetup: scoped saves, specific failures, verified completion, no leaks. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertPermission: vi.fn(async () => ({ id: "00000000-0000-4000-8000-0000000000ad" })) }));

const update = vi.fn();
let result: { data: unknown; error: unknown } = { data: [{ id: 1 }], error: null };
const builder = { update: (v: unknown) => { update(v); return builder; }, eq: () => builder, select: async () => result };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: () => builder }) }));

const loadSetupProgress = vi.fn();
vi.mock("@/lib/setup/load", () => ({ loadSetupProgress: (...a: unknown[]) => loadSetupProgress(...a) }));

const { saveSettings, completeSetup } = await import("@/app/(app)/admin/settings/actions");
const { computeSetupProgress } = await import("@/lib/setup/progress");

const church = {
  church_name: "The Kings Tribe", address_line1: "100 Example Avenue", address_line2: "", city: "Springfield", region: "", postal_code: "", country: "",
  phone: "(555) 010-0000", email: "office@example.org", website: "", currency_code: "USD", timezone: "America/Chicago",
  // Other sections' fields are present in the form state but must NOT be written by a step-1 save.
  finance_notification_email: "", requisition_policy: "x", po_instructions: "x", po_footer: "x",
};

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  result = { data: [{ id: 1 }], error: null };
  update.mockClear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("saveSettings", () => {
  it("saves only the step's own columns and confirms success", async () => {
    const r = await saveSettings(church, { sections: ["church", "money"] });
    expect(r).toEqual({ ok: true, data: undefined, message: "Church information saved successfully." });
    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({ church_name: "The Kings Tribe", address_line1: "100 Example Avenue", phone: "(555) 010-0000", currency_code: "USD" });
    expect(written).not.toHaveProperty("requisition_policy");
    expect(written).not.toHaveProperty("finance_notification_email");
  });

  it("rejects missing required church fields inline and writes nothing", async () => {
    const r = await saveSettings({ ...church, address_line1: "", phone: "" }, { sections: ["church", "money"] });
    expect(r).toMatchObject({ ok: false, fieldErrors: { address_line1: "Address line 1 is required.", phone: "Phone is required." } });
    expect(update).not.toHaveBeenCalled();
  });

  it("requires the notification email in the wizard's step 2", async () => {
    const policies = { finance_notification_email: "", requisition_policy: "Submit requests early, please.", po_instructions: "Present this PO to the vendor.", po_footer: "Authorizes listed items only." };
    expect(await saveSettings(policies, { sections: ["notifications", "policy"], requireNotificationEmail: true }))
      .toMatchObject({ ok: false, fieldErrors: { finance_notification_email: "Finance notification email is required." } });
    expect(await saveSettings({ ...policies, finance_notification_email: "finance@example.org" }, { sections: ["notifications", "policy"], requireNotificationEmail: true }))
      .toMatchObject({ ok: true, message: "Notification settings saved successfully." });
  });

  it("turns an unexpected database failure into a specific message without leaking details", async () => {
    result = { data: null, error: { code: "22P02", message: 'invalid input syntax for type uuid: "1"', details: "trigger audit_row_change", hint: null } };
    const r = await saveSettings(church, { sections: ["church", "money"] });
    expect(r).toEqual({ ok: false, error: "Church information could not be saved. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/uuid|22P02|trigger/);
    expect(consoleError).toHaveBeenCalled(); // diagnostics stay on the server
  });

  it("does not report success if no row was actually saved", async () => {
    result = { data: [], error: null };
    expect(await saveSettings(church, { sections: ["church", "money"] })).toEqual({ ok: false, error: "Church information could not be saved. Please try again." });
  });

  it("keeps known database messages (e.g. permission)", async () => {
    result = { data: null, error: { code: "42501", message: "permission denied" } };
    expect(await saveSettings(church, { sections: ["church", "money"] })).toEqual({ ok: false, error: "You do not have permission to do that." });
  });
});

describe("completeSetup", () => {
  const incomplete = computeSetupProgress({ settings: null, activeCategories: { attendance: 1, finance: 1, requisition: 1 }, departmentsReady: 1, activeUsers: 1, usableLinks: 0 });

  it("refuses while required steps are incomplete and names them", async () => {
    loadSetupProgress.mockResolvedValue(incomplete);
    const r = await completeSetup();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Step 1 — Church information");
      expect(r.error).toContain("Step 2 — Notification email & policies");
      expect(r.error).toContain("Step 6 — Create a requisition link");
      expect(r.error).not.toContain("Step 3");
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("marks setup complete only when every required step is done", async () => {
    loadSetupProgress.mockResolvedValue({ ...incomplete, readyToComplete: true, incompleteRequired: [] });
    expect(await completeSetup()).toEqual({ ok: true, data: undefined, message: "Setup completed successfully." });
    expect(update.mock.calls[0][0]).toHaveProperty("setup_completed_at");
  });
});
