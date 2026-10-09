/**
 * Resend / replace invitation. Supabase behaviour mirrored here was verified on
 * the training project (fictional users): re-inviting an unconfirmed user keeps
 * the same auth user id and issues a new token (the earlier one is rejected);
 * re-inviting a confirmed user fails with error code `email_exists` (422).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertPermission: vi.fn(async () => ({ id: MANAGER })) }));

const MANAGER = "99999999-9999-4999-8999-999999999999";
const PENDING = "11111111-1111-4111-8111-111111111111";
const APP_URL = "https://ops.example.org";
const REDIRECT = `${APP_URL}/auth/callback?next=/auth/update-password`;
const TOKEN = "a".repeat(56);
const ACTION_LINK = `https://project.supabase.co/auth/v1/verify?token=${TOKEN}&type=invite&redirect_to=${encodeURIComponent(REDIRECT)}`;

type AuthUser = { id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null };
let authUser: AuthUser;
let profile: { id: string; is_active: boolean } | null;

const getUserById = vi.fn(async () => ({ data: { user: authUser }, error: null as unknown }));
const inviteUserByEmail = vi.fn<(email: string, opts: unknown) => Promise<{ data: { user: { id: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: authUser.id } }, error: null as unknown }));
const generateLink = vi.fn<(params: unknown) => Promise<{ data: { user: { id: string } | null; properties: { action_link?: string; hashed_token?: string } | null }; error: unknown }>>(async () => ({ data: { user: { id: authUser.id }, properties: { action_link: ACTION_LINK, hashed_token: "h".repeat(56) } }, error: null as unknown }));
const createUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { getUserById, inviteUserByEmail, generateLink, createUser } } }),
}));

// Every table write goes through here, so we can prove profiles and roles are untouched.
const writes: { table: string; op: string }[] = [];
const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data: null; error: unknown }>>(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc,
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const op of ["insert", "update", "upsert", "delete"]) c[op] = () => { writes.push({ table, op }); return c; };
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: table === "profiles" ? profile : null, error: null });
      return c;
    },
  }),
}));

const { resendInvitation } = await import("@/app/(app)/admin/users/actions");

const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
const logged = () => JSON.stringify(consoleError.mock.calls);

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = `${APP_URL}/`;
  authUser = { id: PENDING, email: "jordan.hayes@demo.invalid", email_confirmed_at: null, last_sign_in_at: null };
  profile = { id: PENDING, is_active: true };
});
afterEach(() => { delete process.env.NEXT_PUBLIC_APP_URL; });

describe("pending user", () => {
  it("email: Supabase re-sends the invitation to the same account", async () => {
    const r = await resendInvitation(PENDING, "email");
    expect(r).toEqual({ ok: true, data: { link: undefined, auditRecorded: true }, message: "Invitation sent." });
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(inviteUserByEmail).toHaveBeenCalledWith("jordan.hayes@demo.invalid", { redirectTo: REDIRECT });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("link: a replacement invite link is created and returned once", async () => {
    const r = await resendInvitation(PENDING, "link");
    expect(r).toEqual({ ok: true, data: { link: ACTION_LINK, auditRecorded: true }, message: "New invitation link created." });
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "jordan.hayes@demo.invalid", options: { redirectTo: REDIRECT } });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it.each(["email", "link"] as const)("%s: roles and profile are preserved (no table writes; no metadata overwrite)", async (how) => {
    await resendInvitation(PENDING, how);
    expect(writes).toEqual([]);
    const opts = how === "email" ? inviteUserByEmail.mock.calls[0][1] : (generateLink.mock.calls[0][0] as { options: unknown }).options;
    expect(opts).not.toHaveProperty("data");
  });

  it.each(["email", "link"] as const)("%s: no duplicate auth user or profile is created", async (how) => {
    await resendInvitation(PENDING, how);
    expect(createUser).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it.each(["email", "link"] as const)("%s: refuses if Supabase answers with a different account", async (how) => {
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: { id: MANAGER } }, error: null });
    generateLink.mockResolvedValueOnce({ data: { user: { id: MANAGER }, properties: { action_link: ACTION_LINK, hashed_token: "x" } }, error: null });
    expect(await resendInvitation(PENDING, how)).toEqual({ ok: false, error: "Unable to create a new invitation." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("redirect", () => {
  it("uses NEXT_PUBLIC_APP_URL (trailing slash trimmed) and /auth/callback?next=/auth/update-password", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ops.thekingstribe.org/";
    await resendInvitation(PENDING, "email");
    await resendInvitation(PENDING, "link");
    expect(inviteUserByEmail.mock.calls[0][1]).toEqual({ redirectTo: "https://ops.thekingstribe.org/auth/callback?next=/auth/update-password" });
    expect(generateLink.mock.calls[0][0]).toMatchObject({ options: { redirectTo: "https://ops.thekingstribe.org/auth/callback?next=/auth/update-password" } });
  });
});

describe("active user", () => {
  it.each([
    ["confirmed email", { email_confirmed_at: "2026-10-01T12:00:00Z" }],
    ["has signed in", { last_sign_in_at: "2026-10-02T12:00:00Z" }],
  ])("cannot be re-invited (%s); directed to password reset", async (_label, fields) => {
    authUser = { ...authUser, ...fields };
    for (const how of ["email", "link"] as const) {
      expect(await resendInvitation(PENDING, how)).toEqual({ ok: false, error: "This user has already activated their account. Use password reset instead." });
    }
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepted between page load and click: Supabase email_exists maps to the password-reset message", async () => {
    generateLink.mockResolvedValueOnce({ data: { user: null, properties: null } as never, error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" } });
    expect(await resendInvitation(PENDING, "link")).toEqual({ ok: false, error: "This user has already activated their account. Use password reset instead." });
  });
});

describe("deactivated users", () => {
  it("pending + deactivated: refused until reactivated; Supabase is not called", async () => {
    profile = { id: PENDING, is_active: false };
    for (const how of ["email", "link"] as const) {
      expect(await resendInvitation(PENDING, how)).toEqual({ ok: false, error: "Reactivate this user before sending a new invitation." });
    }
    expect(getUserById).not.toHaveBeenCalled();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("unknown user is refused", async () => {
    profile = null;
    expect(await resendInvitation(PENDING, "email")).toEqual({ ok: false, error: "User not found." });
  });
});

describe("secrets never persisted or logged", () => {
  it.each(["email", "link"] as const)("%s: audit records only user id + delivery — no token or URL", async (how) => {
    await resendInvitation(PENDING, how);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_invitation_reissued", { p_user_id: PENDING, p_delivery: how });
    const sent = JSON.stringify(rpc.mock.calls);
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain("http");
    expect(writes).toEqual([]);
  });

});

describe("audit outcome", () => {
  const auditFails = () => rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for function log_invitation_reissued; raw detail" } });

  it("email + audit succeeds → plain success", async () => {
    expect(await resendInvitation(PENDING, "email")).toEqual({ ok: true, data: { link: undefined, auditRecorded: true }, message: "Invitation sent." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("email + audit fails → invitation stands, truthful warning, safe log", async () => {
    auditFails();
    const r = await resendInvitation(PENDING, "email");
    expect(r).toEqual({ ok: true, data: { link: undefined, auditRecorded: false }, message: "Invitation sent, but the audit record could not be written. Please contact an administrator." });
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Invitation audit failed", { delivery: "email", code: "42501" });
    expect(logged()).not.toContain("raw detail");
  });

  it("link + audit succeeds → plain success with the link", async () => {
    expect(await resendInvitation(PENDING, "link")).toEqual({ ok: true, data: { link: ACTION_LINK, auditRecorded: true }, message: "New invitation link created." });
  });

  it("link + audit fails → link still returned once, truthful warning, safe log", async () => {
    auditFails();
    const r = await resendInvitation(PENDING, "link");
    expect(r).toEqual({ ok: true, data: { link: ACTION_LINK, auditRecorded: false }, message: "New invitation link created, but the audit record could not be written. Please contact an administrator." });
    expect(consoleError).toHaveBeenCalledWith("Invitation audit failed", { delivery: "link", code: "42501" });
  });

  it.each(["email", "link"] as const)("%s: neither the warning nor the log contains the token, link or email", async (how) => {
    auditFails();
    const r = await resendInvitation(PENDING, how);
    expect(r.ok && r.message).toBeTruthy();
    for (const text of [r.ok ? r.message : "", logged()]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("supabase.co");
      expect(text).not.toContain("jordan.hayes");
      expect(text).not.toContain("raw detail");
    }
  });
});

/**
 * Email resend (inviteUserByEmail). Not sent for real. Behaviour mirrored from
 * the Supabase Auth /invite handler (supabase/auth internal/api/invite.go):
 * an existing user with email_confirmed_at = null is re-invited in place (no
 * new user; new confirmation token; invited_at/confirmation_sent_at updated;
 * `data` is ignored for existing users); a confirmed user gets 422
 * `email_exists`. The SDK (auth-js 2.117.2) POSTs /invite with redirectTo as
 * the redirect_to query parameter.
 */
describe("email resend semantics", () => {
  it("existing pending user: re-invited in place, same id, roles/profile untouched", async () => {
    const r = await resendInvitation(PENDING, "email");
    expect(r.ok).toBe(true);
    expect(getUserById).toHaveBeenCalledWith(PENDING);
    expect(inviteUserByEmail).toHaveBeenCalledWith("jordan.hayes@demo.invalid", { redirectTo: REDIRECT });
    expect(createUser).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("existing confirmed user: rejected before the provider, safe message", async () => {
    authUser = { ...authUser, email_confirmed_at: "2026-10-01T12:00:00Z" };
    expect(await resendInvitation(PENDING, "email")).toEqual({ ok: false, error: "This user has already activated their account. Use password reset instead." });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("provider email_exists race (accepted after our check): safe message, nothing audited or written", async () => {
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" } });
    expect(await resendInvitation(PENDING, "email")).toEqual({ ok: false, error: "This user has already activated their account. Use password reset instead." });
    expect(rpc).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe("provider errors return safe messages", () => {
  const raw = { code: "unexpected_failure", status: 500, message: "Database error finding user: pq: internal detail for jordan.hayes@demo.invalid" };

  it.each(["email", "link"] as const)("%s: raw Supabase error is replaced and not echoed", async (how) => {
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: null } as never, error: raw });
    generateLink.mockResolvedValueOnce({ data: { user: null, properties: null } as never, error: raw });
    const r = await resendInvitation(PENDING, how);
    expect(r).toEqual({ ok: false, error: "Unable to create a new invitation." });
    expect(logged()).not.toContain("internal detail");
    expect(logged()).not.toContain("jordan.hayes");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lookup failure is safe", async () => {
    getUserById.mockResolvedValueOnce({ data: { user: null } as never, error: raw });
    expect(await resendInvitation(PENDING, "email")).toEqual({ ok: false, error: "Unable to create a new invitation." });
    expect(logged()).not.toContain("internal detail");
  });

  it("missing action_link is safe", async () => {
    generateLink.mockResolvedValueOnce({ data: { user: { id: PENDING }, properties: {} } as never, error: null });
    expect(await resendInvitation(PENDING, "link")).toEqual({ ok: false, error: "Unable to create a new invitation." });
  });

  it("invalid input is rejected before any provider call", async () => {
    expect((await resendInvitation("not-a-uuid", "email")).ok).toBe(false);
    expect((await resendInvitation(PENDING, "sms" as never)).ok).toBe(false);
    expect(getUserById).not.toHaveBeenCalled();
  });
});
