// @vitest-environment jsdom
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";

const sendAccountSetup = vi.fn();
const setUserActive = vi.fn();
vi.mock("@/app/(app)/admin/users/actions", () => ({
  inviteUser: vi.fn(),
  setUserRole: vi.fn(),
  setUserActive: (...a: unknown[]) => setUserActive(...a),
  sendAccountSetup: (...a: unknown[]) => sendAccountSetup(...a),
}));

const { UserAdmin } = await import("@/app/(app)/admin/users/user-admin");

const ME = "00000000-0000-4000-8000-000000000000";
const base = { roleIds: [], lastSignIn: null };
const users = [
  // Invited, link never opened.
  { ...base, id: "p", email: "jordan@demo.invalid", full_name: "Jordan Hayes", is_active: true, setupCompleted: false, emailConfirmed: false },
  // Opened the invitation (Supabase: confirmed + signed in) but never chose a password.
  { ...base, id: "r", email: "frankie@demo.invalid", full_name: "Frankie Lee", is_active: true, setupCompleted: false, emailConfirmed: true, lastSignIn: "2026-10-09T02:19:48Z" },
  { ...base, id: "a", email: "taylor@demo.invalid", full_name: "Taylor Brooks", is_active: true, setupCompleted: true, emailConfirmed: true, lastSignIn: "2026-10-08T12:00:00Z" },
  { ...base, id: "d", email: "riley@demo.invalid", full_name: "Riley Moss", is_active: false, setupCompleted: true, emailConfirmed: true },
  { ...base, id: "pd", email: "casey@demo.invalid", full_name: "Casey Lane", is_active: false, setupCompleted: false, emailConfirmed: false },
];
const INVITE_LINK = "https://project.supabase.co/auth/v1/verify?token=secret-token&type=invite";
const RECOVERY_LINK = "https://project.supabase.co/auth/v1/verify?token=secret-token&type=recovery";
const SETUP_BUTTONS = /invitation|recovery/i;

function renderAdmin() {
  render(<ToastProvider><UserAdmin users={users} roles={[]} currentUserId={ME} /></ToastProvider>);
  return { row: (name: string) => screen.getByText(name).closest("li") as HTMLElement };
}
const toastIn = async (live: "polite" | "assertive", text: string) => {
  const region = await waitFor(() => screen.getAllByRole(live === "assertive" ? "alert" : "status").find((el) => el.getAttribute("aria-live") === live)!);
  expect(await within(region).findByText(text)).toBeTruthy();
};

beforeEach(() => {
  sendAccountSetup.mockReset();
  setUserActive.mockReset();
});

describe("controls by state", () => {
  it("pending, never confirmed: Resend invitation + Replace invitation link + Deactivate", () => {
    const r = renderAdmin().row("Jordan Hayes");
    expect(within(r).getByRole("button", { name: "Resend invitation" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Replace invitation link" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(within(r).getByText("Invitation pending")).toBeTruthy();
  });

  it("pending but confirmed by Supabase (has a last sign-in): recovery actions, not invitation actions", () => {
    const r = renderAdmin().row("Frankie Lee");
    expect(within(r).getByRole("button", { name: "Send recovery email" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Create recovery link" })).toBeTruthy();
    expect(within(r).queryByRole("button", { name: /invitation/i })).toBeNull();
    expect(within(r).getByText("Setup incomplete")).toBeTruthy();
    expect(within(r).getByText(/Last sign-in/)).toBeTruthy();
  });

  it("active: no setup controls, only Deactivate", () => {
    const r = renderAdmin().row("Taylor Brooks");
    expect(within(r).queryByRole("button", { name: SETUP_BUTTONS })).toBeNull();
    expect(within(r).getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(within(r).queryByText(/Setup incomplete|Invitation pending/)).toBeNull();
  });

  it("deactivated (setup complete): Reactivate only", () => {
    const r = renderAdmin().row("Riley Moss");
    expect(within(r).queryByRole("button", { name: SETUP_BUTTONS })).toBeNull();
    expect(within(r).getByRole("button", { name: "Reactivate" })).toBeTruthy();
  });

  it("deactivated (setup pending): Reactivate first; nothing can be sent", () => {
    const r = renderAdmin().row("Casey Lane");
    expect(within(r).queryByRole("button", { name: SETUP_BUTTONS })).toBeNull();
    expect(within(r).getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(within(r).getByText("Reactivate this user before sending a new invitation.")).toBeTruthy();
  });
});

describe("invitation channel", () => {
  it("Resend invitation → success toast", async () => {
    sendAccountSetup.mockResolvedValue({ ok: true, data: { channel: "invite", auditRecorded: true }, message: "Invitation sent." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    await toastIn("polite", "Invitation sent.");
    expect(sendAccountSetup).toHaveBeenCalledWith("p", "email");
  });

  it("Replace invitation link shows it once and forgets it on close", async () => {
    sendAccountSetup.mockResolvedValue({ ok: true, data: { link: INVITE_LINK, channel: "invite", auditRecorded: true }, message: "New invitation link created." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    expect(sendAccountSetup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    expect(((await screen.findByLabelText("Invitation link")) as HTMLInputElement).value).toBe(INVITE_LINK);
    expect(sendAccountSetup).toHaveBeenCalledWith("p", "link");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByDisplayValue(INVITE_LINK)).toBeNull());
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    expect(screen.queryByDisplayValue(INVITE_LINK)).toBeNull();
  });
});

describe("recovery channel (opened invitation, no password)", () => {
  it("Send recovery email → success toast", async () => {
    sendAccountSetup.mockResolvedValue({ ok: true, data: { channel: "recovery", auditRecorded: true }, message: "Recovery email sent." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Frankie Lee")).getByRole("button", { name: "Send recovery email" }));
    await toastIn("polite", "Recovery email sent.");
    expect(sendAccountSetup).toHaveBeenCalledWith("r", "email");
  });

  it("Create recovery link shows it once with the recovery wording", async () => {
    sendAccountSetup.mockResolvedValue({ ok: true, data: { link: RECOVERY_LINK, channel: "recovery", auditRecorded: true }, message: "Recovery link created." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Frankie Lee")).getByRole("button", { name: "Create recovery link" }));
    expect(screen.getByText(/opened their invitation but has not chosen a password yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    expect(((await screen.findByLabelText("Recovery link")) as HTMLInputElement).value).toBe(RECOVERY_LINK);
    expect(screen.getByText("Recovery link created")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByDisplayValue(RECOVERY_LINK)).toBeNull());
  });

  it("audit failure → link still shown once, with the warning", async () => {
    const warning = "Recovery link created, but the audit record could not be written. Please contact an administrator.";
    sendAccountSetup.mockResolvedValue({ ok: true, data: { link: RECOVERY_LINK, channel: "recovery", auditRecorded: false }, message: warning });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Frankie Lee")).getByRole("button", { name: "Create recovery link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    expect(((await screen.findByLabelText("Recovery link")) as HTMLInputElement).value).toBe(RECOVERY_LINK);
    expect(screen.getByText("Audit record not written")).toBeTruthy();
    await toastIn("assertive", warning);
  });

  it("audit failure on email → prominent warning toast, not a plain success", async () => {
    const warning = "Recovery email sent, but the audit record could not be written. Please contact an administrator.";
    sendAccountSetup.mockResolvedValue({ ok: true, data: { channel: "recovery", auditRecorded: false }, message: warning });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Frankie Lee")).getByRole("button", { name: "Send recovery email" }));
    await toastIn("assertive", warning);
  });
});

describe("errors", () => {
  it("shows the server's safe error message", async () => {
    sendAccountSetup.mockResolvedValue({ ok: false, error: "This user has already activated their account. Use password reset instead." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    expect((await screen.findAllByText("This user has already activated their account. Use password reset instead.")).length).toBeGreaterThan(0);
  });

  it("an unexpected failure falls back to a safe message for the channel", async () => {
    sendAccountSetup.mockRejectedValue(new Error("fetch failed: raw provider detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { row } = renderAdmin();
    fireEvent.click(within(row("Frankie Lee")).getByRole("button", { name: "Send recovery email" }));
    expect((await screen.findAllByText("Unable to create a recovery link.")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw provider detail/)).toBeNull();
  });
});
