/**
 * Account setup is marked complete only after Supabase accepts a password the
 * person chose (update-password) or a password sign-in. Opening an invitation
 * or recovery link (which signs them in) never marks it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const USER = "33333333-3333-4333-8333-333333333333";
const redirect = vi.fn((path: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` }); });
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("@/lib/flash-server", () => ({ setFlash: vi.fn() }));

let profile: { is_active: boolean; account_setup_completed_at: string | null } | null;
const auth = {
  getUser: vi.fn(async () => ({ data: { user: { id: USER, email: "invitee@demo.invalid" } } })),
  updateUser: vi.fn<(input: unknown) => Promise<{ data: { user: { id: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: USER } }, error: null })),
  signInWithPassword: vi.fn<(input: unknown) => Promise<{ data: { user: { id: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: USER } }, error: null })),
  signOut: vi.fn(async () => ({ error: null })),
};
const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: string | null; error: unknown }>>(async () => ({ data: "2026-10-08T00:00:00Z", error: null }));
const profileEq = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth,
    rpc,
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.update = () => c;
      c.eq = (col: string, val: unknown) => { profileEq(col, val); return c; };
      c.maybeSingle = async () => ({ data: profile, error: null });
      c.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return c;
    },
  }),
}));

const { updatePassword } = await import("@/app/auth/update-password/actions");
const { signIn } = await import("@/app/(auth)/login/actions");

const fd = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
const PASSWORD = "a long enough password";
const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  profile = { is_active: true, account_setup_completed_at: null };
});

describe("update-password (invite or recovery link → choose a password)", () => {
  it("successful updateUser(password) marks setup complete, then redirects", async () => {
    await expect(updatePassword(undefined, fd({ password: PASSWORD, confirm: PASSWORD }))).rejects.toMatchObject({ digest: expect.stringContaining("/dashboard") });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(rpc).toHaveBeenCalledWith("mark_account_setup_complete", { p_method: "password_set" });
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it("a failed password update does not mark setup complete", async () => {
    auth.updateUser.mockResolvedValueOnce({ data: { user: null } as never, error: { code: "weak_password", status: 422, message: "weak" } });
    const r = await updatePassword(undefined, fd({ password: PASSWORD, confirm: PASSWORD }));
    expect(r?.error).toBe("Unable to update your password. Please try again.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an invalid form never reaches Supabase or the marker", async () => {
    await updatePassword(undefined, fd({ password: PASSWORD, confirm: "different" }));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("without a session (expired link) nothing is marked", async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: null } as never });
    expect(await updatePassword(undefined, fd({ password: PASSWORD, confirm: PASSWORD }))).toEqual({ error: "Your link has expired. Request a new one." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("if the marker fails the password change still stands; only the error code is logged", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "detail with secret-ish text" } });
    await expect(updatePassword(undefined, fd({ password: PASSWORD, confirm: PASSWORD }))).rejects.toMatchObject({ digest: expect.stringContaining("/dashboard") });
    expect(consoleError).toHaveBeenCalledWith("Account setup marker failed", { code: "42501" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(PASSWORD);
  });
});

describe("password sign-in", () => {
  const login = () => signIn(undefined, fd({ email: "invitee@demo.invalid", password: PASSWORD, next: "/dashboard" }));

  it("marks a legacy user (setup null) complete", async () => {
    await expect(login()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(rpc).toHaveBeenCalledWith("mark_account_setup_complete", { p_method: "password_sign_in" });
    expect(profileEq).toHaveBeenCalledWith("id", USER);
  });

  it("an already-active user is left alone on later sign-ins", async () => {
    profile = { is_active: true, account_setup_completed_at: "2026-10-01T00:00:00Z" };
    await expect(login()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a failed sign-in marks nothing", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null } as never, error: { code: "invalid_credentials" } });
    expect(await login()).toEqual({ error: "Sign in failed. Please check your email and password." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a deactivated user is signed out and not marked", async () => {
    profile = { is_active: false, account_setup_completed_at: null };
    expect(await login()).toEqual({ error: "Your account has been deactivated. Contact an administrator." });
    expect(auth.signOut).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
