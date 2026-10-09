// @vitest-environment jsdom
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";

const resendInvitation = vi.fn();
const setUserActive = vi.fn();
vi.mock("@/app/(app)/admin/users/actions", () => ({
  inviteUser: vi.fn(),
  setUserRole: vi.fn(),
  setUserActive: (...a: unknown[]) => setUserActive(...a),
  resendInvitation: (...a: unknown[]) => resendInvitation(...a),
}));

const { UserAdmin } = await import("@/app/(app)/admin/users/user-admin");

const ME = "00000000-0000-4000-8000-000000000000";
const base = { roleIds: [], lastSignIn: null };
const users = [
  { ...base, id: "p", email: "jordan@demo.invalid", full_name: "Jordan Hayes", is_active: true, confirmed: false },
  { ...base, id: "a", email: "taylor@demo.invalid", full_name: "Taylor Brooks", is_active: true, confirmed: true },
  { ...base, id: "d", email: "riley@demo.invalid", full_name: "Riley Moss", is_active: false, confirmed: true },
  { ...base, id: "pd", email: "casey@demo.invalid", full_name: "Casey Lane", is_active: false, confirmed: false },
];
const LINK = "https://project.supabase.co/auth/v1/verify?token=secret-token&type=invite";

function renderAdmin() {
  render(<ToastProvider><UserAdmin users={users} roles={[]} currentUserId={ME} /></ToastProvider>);
  const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
  return { row };
}

beforeEach(() => {
  resendInvitation.mockReset();
  setUserActive.mockReset();
});

describe("invitation actions by state", () => {
  it("pending: Resend invitation and Replace invitation link", () => {
    const { row } = renderAdmin();
    expect(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" })).toBeTruthy();
    expect(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" })).toBeTruthy();
  });

  it("active: no invitation actions, only Deactivate", () => {
    const { row } = renderAdmin();
    const r = row("Taylor Brooks");
    expect(within(r).queryByRole("button", { name: /invitation/i })).toBeNull();
    expect(within(r).getByRole("button", { name: "Deactivate" })).toBeTruthy();
  });

  it("deactivated: Reactivate only", () => {
    const { row } = renderAdmin();
    const r = row("Riley Moss");
    expect(within(r).queryByRole("button", { name: /invitation/i })).toBeNull();
    expect(within(r).getByRole("button", { name: "Reactivate" })).toBeTruthy();
  });

  it("pending + deactivated: Reactivate first, no invitation actions", () => {
    const { row } = renderAdmin();
    const r = row("Casey Lane");
    expect(within(r).queryByRole("button", { name: /invitation/i })).toBeNull();
    expect(within(r).getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(within(r).getByText("Reactivate this user before sending a new invitation.")).toBeTruthy();
  });
});

describe("resend and replace", () => {
  it("Resend invitation emails via the server action and toasts", async () => {
    resendInvitation.mockResolvedValue({ ok: true, data: { auditRecorded: true }, message: "Invitation sent." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    expect(await screen.findByText("Invitation sent.")).toBeTruthy();
    expect(resendInvitation).toHaveBeenCalledWith("p", "email");
  });

  it("Replace invitation link shows the new link once, and forgets it on close", async () => {
    resendInvitation.mockResolvedValue({ ok: true, data: { link: LINK, auditRecorded: true }, message: "New invitation link created." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    expect(resendInvitation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    const input = (await screen.findByLabelText("Invitation link")) as HTMLInputElement;
    expect(input.value).toBe(LINK);
    expect(resendInvitation).toHaveBeenCalledWith("p", "link");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByDisplayValue(LINK)).toBeNull());
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    expect(screen.queryByDisplayValue(LINK)).toBeNull();
    expect(screen.getByRole("button", { name: "Create new link" })).toBeTruthy();
  });

  const toastIn = async (live: "polite" | "assertive", text: string) => {
    const region = await waitFor(() => screen.getAllByRole(live === "assertive" ? "alert" : "status").find((el) => el.getAttribute("aria-live") === live)!);
    expect(await within(region).findByText(text)).toBeTruthy();
  };

  it("Resend invitation: audit succeeded → success toast", async () => {
    resendInvitation.mockResolvedValue({ ok: true, data: { auditRecorded: true }, message: "Invitation sent." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    await toastIn("polite", "Invitation sent.");
  });

  it("Resend invitation: audit failed → prominent warning toast, not a plain success", async () => {
    const warning = "Invitation sent, but the audit record could not be written. Please contact an administrator.";
    resendInvitation.mockResolvedValue({ ok: true, data: { auditRecorded: false }, message: warning });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    await toastIn("assertive", warning);
    expect(screen.queryByText("Invitation sent.")).toBeNull();
  });

  it("Replace invitation link: audit failed → link still shown once, with the warning", async () => {
    const warning = "New invitation link created, but the audit record could not be written. Please contact an administrator.";
    resendInvitation.mockResolvedValue({ ok: true, data: { link: LINK, auditRecorded: false }, message: warning });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    expect(((await screen.findByLabelText("Invitation link")) as HTMLInputElement).value).toBe(LINK);
    expect(screen.getByText("Audit record not written")).toBeTruthy();
    expect(screen.queryByText("New invitation link created")).toBeNull();
    await toastIn("assertive", warning);
  });

  it("Replace invitation link: audit succeeded → normal success panel", async () => {
    resendInvitation.mockResolvedValue({ ok: true, data: { link: LINK, auditRecorded: true }, message: "New invitation link created." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Replace invitation link" }));
    fireEvent.click(screen.getByRole("button", { name: "Create new link" }));
    expect(await screen.findByText("New invitation link created")).toBeTruthy();
    expect(screen.queryByText("Audit record not written")).toBeNull();
  });

  it("shows the server's safe error message", async () => {
    resendInvitation.mockResolvedValue({ ok: false, error: "This user has already activated their account. Use password reset instead." });
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    expect((await screen.findAllByText("This user has already activated their account. Use password reset instead.")).length).toBeGreaterThan(0);
  });

  it("an unexpected failure falls back to a safe message", async () => {
    resendInvitation.mockRejectedValue(new Error("fetch failed: raw provider detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { row } = renderAdmin();
    fireEvent.click(within(row("Jordan Hayes")).getByRole("button", { name: "Resend invitation" }));
    expect((await screen.findAllByText("Unable to create a new invitation.")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw provider detail/)).toBeNull();
  });
});
