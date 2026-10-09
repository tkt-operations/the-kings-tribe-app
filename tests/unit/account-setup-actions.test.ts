/**
 * sendAccountSetup: a new setup link for someone whose account setup is not
 * complete. Supabase behaviour mirrored here (auth v2.197.0 source, and verified
 * on the training project for invites):
 *  - /invite and generate_link(invite) re-invite an existing UNCONFIRMED user in
 *    place (same id, new token); a CONFIRMED user gets 422 `email_exists`.
 *  - /recover and generate_link(recovery) act on an existing user only (never
 *    create one); a new recovery token replaces the previous one.
 *  - The admin client uses the implicit flow, so links work on any device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertPermission: vi.fn(async () => ({ id: MANAGER })) }));

const MANAGER = "99999999-9999-4999-8999-999999999999";
const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "jordan.hayes@demo.invalid";
const PROD = "https://ops.thekingstribe.org";
const REDIRECT = `${PROD}/auth/callback?next=/auth/update-password`;
const TOKEN = "a".repeat(56);
const INVITE_LINK = `https://project.supabase.co/auth/v1/verify?token=${TOKEN}&type=invite&redirect_to=${encodeURIComponent(REDIRECT)}`;
const RECOVERY_LINK = `https://project.supabase.co/auth/v1/verify?token=${TOKEN}&type=recovery&redirect_to=${encodeURIComponent(REDIRECT)}`;
const ALREADY = "This user has already activated their account. Use password reset instead.";

type AuthUser = { id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null };
type Result = { data: { user: { id: string } | null; properties?: { action_link?: string } | null }; error: unknown };
let authUser: AuthUser;
let profile: { id: string; is_active: boolean; account_setup_completed_at: string | null } | null;

const getUserById = vi.fn<(id: string) => Promise<{ data: { user: AuthUser | null }; error: unknown }>>(async () => ({ data: { user: authUser }, error: null }));
const inviteUserByEmail = vi.fn<(email: string, opts: unknown) => Promise<Result>>(async () => ({ data: { user: { id: authUser.id } }, error: null }));
const generateLink = vi.fn<(params: { type: string; email: string; options: unknown }) => Promise<Result>>(async (params) => ({
  data: { user: { id: authUser.id }, properties: { action_link: params.type === "invite" ? INVITE_LINK : RECOVERY_LINK } }, error: null,
}));
const resetPasswordForEmail = vi.fn<(email: string, opts: unknown) => Promise<{ data: object; error: unknown }>>(async () => ({ data: {}, error: null }));
const createUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { resetPasswordForEmail, admin: { getUserById, inviteUserByEmail, generateLink, createUser } } }),
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

const { sendAccountSetup } = await import("@/app/(app)/admin/users/actions");

const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
const logged = () => JSON.stringify(consoleError.mock.calls);
const providerCalls = () => JSON.stringify([inviteUserByEmail.mock.calls, generateLink.mock.calls, resetPasswordForEmail.mock.calls]);

const unconfirmed = () => { authUser = { id: USER, email: EMAIL, email_confirmed_at: null, last_sign_in_at: null }; };
// What Supabase leaves behind when an invitation link is opened but no password is chosen.
const openedInvite = () => { authUser = { id: USER, email: EMAIL, email_confirmed_at: "2026-10-09T00:32:38Z", last_sign_in_at: "2026-10-09T02:19:48Z" }; };

beforeEach(() => {
  vi.clearAllMocks();
  // Also drop any unconsumed mockResolvedValueOnce results (back to the vi.fn defaults).
  for (const m of [getUserById, inviteUserByEmail, generateLink, resetPasswordForEmail, rpc]) m.mockReset();
  writes.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = `${PROD}/`;
  unconfirmed();
  profile = { id: USER, is_active: true, account_setup_completed_at: null };
});
afterEach(() => { delete process.env.NEXT_PUBLIC_APP_URL; });

describe("pending setup, invitation never opened → invitation", () => {
  it("email: re-sends the invitation to the same account", async () => {
    expect(await sendAccountSetup(USER, "email")).toEqual({ ok: true, data: { link: undefined, channel: "invite", auditRecorded: true }, message: "Invitation sent." });
    expect(inviteUserByEmail).toHaveBeenCalledWith(EMAIL, { redirectTo: REDIRECT });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("link: a replacement invitation link, returned once", async () => {
    expect(await sendAccountSetup(USER, "link")).toEqual({ ok: true, data: { link: INVITE_LINK, channel: "invite", auditRecorded: true }, message: "New invitation link created." });
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: EMAIL, options: { redirectTo: REDIRECT } });
  });

  it("audited as an invitation re-issue", async () => {
    await sendAccountSetup(USER, "link");
    expect(rpc).toHaveBeenCalledWith("log_invitation_reissued", { p_user_id: USER, p_delivery: "link" });
  });
});

describe("pending setup, invitation already opened (Supabase confirmed + signed in) → recovery, never invite", () => {
  beforeEach(openedInvite);

  it("email: recovery email via the admin client; inviteUserByEmail is never called", async () => {
    expect(await sendAccountSetup(USER, "email")).toEqual({ ok: true, data: { link: undefined, channel: "recovery", auditRecorded: true }, message: "Recovery email sent." });
    expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, { redirectTo: REDIRECT });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("link: a recovery link for the same user, returned once", async () => {
    expect(await sendAccountSetup(USER, "link")).toEqual({ ok: true, data: { link: RECOVERY_LINK, channel: "recovery", auditRecorded: true }, message: "Recovery link created." });
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: EMAIL, options: { redirectTo: REDIRECT } });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it.each(["email", "link"] as const)("%s: audited as a recovery issue", async (how) => {
    await sendAccountSetup(USER, how);
    expect(rpc).toHaveBeenCalledWith("log_account_recovery_issued", { p_user_id: USER, p_delivery: how });
  });

  it("last_sign_in_at from an invite/recovery session alone does not block recovery", async () => {
    authUser = { ...authUser, email_confirmed_at: null };
    // Unconfirmed but signed in: still pending (setup marker null) → invitation channel.
    expect((await sendAccountSetup(USER, "link")).ok).toBe(true);
  });

  it("recovery link for a different account is refused", async () => {
    generateLink.mockResolvedValueOnce({ data: { user: { id: MANAGER }, properties: { action_link: RECOVERY_LINK } }, error: null });
    expect(await sendAccountSetup(USER, "link")).toEqual({ ok: false, error: "Unable to create a recovery link." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("race: confirmed between page load and click", () => {
  it.each(["email", "link"] as const)("%s: email_exists from the invite API falls back to recovery for the same user", async (how) => {
    const exists = { code: "email_exists", status: 422, message: "A user with this email address has already been registered" };
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: null }, error: exists });
    generateLink.mockResolvedValueOnce({ data: { user: null, properties: null }, error: exists });
    const r = await sendAccountSetup(USER, how);
    expect(r.ok && r.data.channel).toBe("recovery");
    if (how === "email") expect(resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, { redirectTo: REDIRECT });
    else expect(generateLink).toHaveBeenLastCalledWith({ type: "recovery", email: EMAIL, options: { redirectTo: REDIRECT } });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("account setup completed (active)", () => {
  it.each(["email", "link"] as const)("%s: refused — use Forgot password; Supabase not called", async (how) => {
    profile = { id: USER, is_active: true, account_setup_completed_at: "2026-10-01T00:00:00Z" };
    expect(await sendAccountSetup(USER, how)).toEqual({ ok: false, error: ALREADY });
    expect(getUserById).not.toHaveBeenCalled();
    expect(providerCalls()).toBe("[[],[],[]]");
  });
});

describe("deactivated", () => {
  it.each([null, "2026-10-01T00:00:00Z"])("setup=%s: must reactivate first; nothing sent", async (setup) => {
    profile = { id: USER, is_active: false, account_setup_completed_at: setup };
    for (const how of ["email", "link"] as const) {
      expect(await sendAccountSetup(USER, how)).toEqual({ ok: false, error: "Reactivate this user before sending a new invitation." });
    }
    expect(getUserById).not.toHaveBeenCalled();
    expect(providerCalls()).toBe("[[],[],[]]");
  });

  it("unknown user is refused", async () => {
    profile = null;
    expect(await sendAccountSetup(USER, "email")).toEqual({ ok: false, error: "User not found." });
  });
});

describe("same account; profile and roles preserved", () => {
  it.each([["invite", unconfirmed], ["recovery", openedInvite]] as const)("%s: no table writes, no createUser, no metadata overwrite", async (_c, setup) => {
    setup();
    for (const how of ["email", "link"] as const) await sendAccountSetup(USER, how);
    expect(writes).toEqual([]);
    expect(createUser).not.toHaveBeenCalled();
    for (const call of [...inviteUserByEmail.mock.calls.map((c) => c[1]), ...generateLink.mock.calls.map((c) => c[0].options), ...resetPasswordForEmail.mock.calls.map((c) => c[1])]) {
      expect(call).toEqual({ redirectTo: REDIRECT });
    }
  });
});

describe("production redirect", () => {
  it("every channel uses NEXT_PUBLIC_APP_URL = ops.thekingstribe.org + /auth/callback?next=/auth/update-password", async () => {
    await sendAccountSetup(USER, "email");
    await sendAccountSetup(USER, "link");
    openedInvite();
    await sendAccountSetup(USER, "email");
    await sendAccountSetup(USER, "link");
    const redirects = [inviteUserByEmail.mock.calls[0][1], generateLink.mock.calls[0][0].options, resetPasswordForEmail.mock.calls[0][1], generateLink.mock.calls[1][0].options];
    expect(redirects).toEqual(Array(4).fill({ redirectTo: "https://ops.thekingstribe.org/auth/callback?next=/auth/update-password" }));
  });
});

describe("audit outcome", () => {
  const auditFails = () => rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "raw detail" } });

  it.each([
    [unconfirmed, "email", "Invitation sent, but the audit record could not be written. Please contact an administrator."],
    [unconfirmed, "link", "New invitation link created, but the audit record could not be written. Please contact an administrator."],
    [openedInvite, "email", "Recovery email sent, but the audit record could not be written. Please contact an administrator."],
    [openedInvite, "link", "Recovery link created, but the audit record could not be written. Please contact an administrator."],
  ] as const)("audit failure → link/email stands, truthful warning (%#)", async (setup, how, warning) => {
    setup();
    auditFails();
    const r = await sendAccountSetup(USER, how);
    expect(r.ok && r.message).toBe(warning);
    expect(r.ok && r.data.auditRecorded).toBe(false);
    expect(consoleError).toHaveBeenCalledWith("Account setup audit failed", expect.objectContaining({ delivery: how, code: "42501" }));
  });
});

describe("secrets never persisted or logged", () => {
  it.each([["invite", unconfirmed], ["recovery", openedInvite]] as const)("%s: audit args, warnings and logs contain no token, link or email", async (_c, setup) => {
    setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "raw detail" } });
    const results = [await sendAccountSetup(USER, "link"), await sendAccountSetup(USER, "email")];
    const safeTexts = [JSON.stringify(rpc.mock.calls), logged(), ...results.map((r) => (r.ok ? r.message ?? "" : r.error))];
    for (const text of safeTexts) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("supabase.co");
      expect(text).not.toContain("jordan.hayes");
      expect(text).not.toContain("raw detail");
    }
    expect(writes).toEqual([]);
  });
});

describe("provider errors return safe messages", () => {
  const raw = { code: "unexpected_failure", status: 500, message: "internal detail for jordan.hayes@demo.invalid" };

  it.each([
    [unconfirmed, "email", "Unable to create a new invitation."],
    [unconfirmed, "link", "Unable to create a new invitation."],
    [openedInvite, "email", "Unable to create a recovery link."],
    [openedInvite, "link", "Unable to create a recovery link."],
  ] as const)("raw error replaced (%#)", async (setup, how, message) => {
    setup();
    inviteUserByEmail.mockResolvedValueOnce({ data: { user: null }, error: raw });
    generateLink.mockResolvedValueOnce({ data: { user: null, properties: null }, error: raw });
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: raw });
    expect(await sendAccountSetup(USER, how)).toEqual({ ok: false, error: message });
    expect(logged()).not.toContain("internal detail");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rate limiting gets a specific, safe message", async () => {
    openedInvite();
    resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" } });
    expect(await sendAccountSetup(USER, "email")).toEqual({ ok: false, error: "An email was sent to this person very recently. Please wait a minute and try again." });
  });

  it("lookup failure and invalid input are safe", async () => {
    getUserById.mockResolvedValueOnce({ data: { user: null }, error: raw });
    expect(await sendAccountSetup(USER, "email")).toEqual({ ok: false, error: "Unable to create a new invitation." });
    expect((await sendAccountSetup("not-a-uuid", "email")).ok).toBe(false);
    expect((await sendAccountSetup(USER, "sms" as never)).ok).toBe(false);
  });
});
