// @vitest-environment jsdom
/**
 * /auth/callback is the single owner of auth-link processing.
 *  - ?code= (PKCE Forgot password) is exchanged exactly once, even in Strict Mode.
 *  - token_hash links are never verified on load: only when the person presses
 *    Continue, so link-preview bots that fetch or render the page cannot use them.
 *  - Only a real verification failure shows an error; a session never does.
 */
import { routerMock } from "./setup";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
};
const createClient = vi.fn(() => ({ auth }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => createClient() }));

const { AuthCallback } = await import("@/app/auth/callback/auth-callback");

const HASH = "c3".repeat(28);
const CODE = "8f14e45f-ceea-4672-a1f2-2c1f5a4b9d10";
const ok = { data: { session: { access_token: "x" }, user: { id: "u" } }, error: null };
const visit = (pathAndQueryAndHash: string) => window.history.replaceState(null, "", pathAndQueryAndHash);
const mount = (strict = false) => render(strict ? <StrictMode><AuthCallback /></StrictMode> : <AuthCallback />);
const EXPIRED = "This link has expired or has already been used";

beforeEach(() => {
  for (const f of Object.values(auth)) f.mockReset();
  createClient.mockClear();
  auth.exchangeCodeForSession.mockResolvedValue(ok);
  auth.verifyOtp.mockResolvedValue(ok);
  auth.setSession.mockResolvedValue(ok);
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
});

describe("PKCE ?code= (Forgot password, same browser)", () => {
  it("is exchanged exactly once, even when Strict Mode runs effects twice", async () => {
    visit(`/auth/callback?next=/auth/update-password&code=${CODE}&sb_flow_id=flow-1`);
    mount(true);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(CODE, { flowId: "flow-1" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  it("a successful exchange shows progress, never the invalid-link message", async () => {
    visit(`/auth/callback?next=/auth/update-password&code=${CODE}`);
    mount();
    expect(await screen.findByText(/Link verified/)).toBeTruthy();
    expect(screen.queryByText(EXPIRED)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opened in a different browser (no verifier) → specific, safe message", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { name: "AuthPKCECodeVerifierMissingError", code: "pkce_code_verifier_not_found", message: "PKCE code verifier not found in storage. raw" } });
    visit(`/auth/callback?next=/auth/update-password&code=${CODE}`);
    mount();
    expect(await screen.findByText("Open this link in the browser you requested it from")).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/raw/)).toBeNull();
  });

  it("an invalid or used code fails safely", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { code: "flow_state_not_found", status: 404, message: "invalid flow state, no valid flow state found" } });
    visit(`/auth/callback?next=/auth/update-password&code=${CODE}`);
    mount();
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(screen.queryByText(/flow state/)).toBeNull();
  });
});

describe("token_hash (canonical; link-preview protected)", () => {
  it("loading the page (what a crawler does) does not verify the token", async () => {
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    mount(true);
    expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("removes the token from the address bar immediately", async () => {
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    mount();
    await screen.findByRole("button", { name: "Continue" });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(HASH);
    expect(window.location.search).toBe("?next=%2Fauth%2Fupdate-password");
  });

  it("Continue verifies once (double click included) and goes to choose a password", async () => {
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    mount();
    const button = await screen.findByRole("button", { name: "Continue" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "recovery" });
  });

  it("crawler fetch first, then the real person: the token is still usable and used once", async () => {
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    const crawler = mount();
    await screen.findByRole("button", { name: "Continue" });
    crawler.unmount();
    expect(auth.verifyOtp).not.toHaveBeenCalled();

    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("invitation links keep the invite type and wording", async () => {
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=invite`);
    mount();
    expect(await screen.findByText("Set up your account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "invite" }));
  });

  it("query-form token_hash (template rollout) is also confirm-first", async () => {
    visit(`/auth/callback?token_hash=${HASH}&type=recovery&next=/auth/update-password`);
    mount();
    expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(HASH);
  });

  it.each([
    ["expired", { code: "otp_expired", status: 403, message: "Email link is invalid or has expired" }, EXPIRED],
    ["superseded by a newer link", { code: "otp_expired", status: 403, message: "Email link is invalid or has expired" }, EXPIRED],
    ["type mismatch (recovery hash sent as invite)", { code: "otp_expired", status: 403, message: "Token has expired or is invalid" }, EXPIRED],
    ["rate limited", { code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" }, "Too many attempts"],
    ["unknown failure", { code: "unexpected_failure", status: 500, message: "internal raw detail" }, "We could not verify this link"],
  ])("%s → safe message, no raw error", async (_label, error, title) => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error });
    visit(`/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText(new RegExp(error.message))).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported type", `#token_hash=${HASH}&type=magiclink`],
    ["non-hex hash", "#token_hash=not-a-hash!&type=recovery"],
    ["missing type", `#token_hash=${HASH}`],
  ])("malformed link (%s) → never sent to Supabase", async (_label, fragment) => {
    visit(`/auth/callback?next=/auth/update-password${fragment}`);
    mount();
    expect(await screen.findByText("This link is incomplete")).toBeTruthy();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("next= allowlisting (no open redirect)", () => {
  it.each(["https://evil.example/steal", "//evil.example", "/admin/users", "/\\evil.example", ""])("next=%s → /auth/update-password", async (next) => {
    visit(`/auth/callback?next=${encodeURIComponent(next)}&code=${CODE}`);
    mount();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
  });
});

describe("legacy and edge cases", () => {
  it("raw Supabase links already sent (#access_token) still work, once", async () => {
    visit("/auth/callback?next=/auth/update-password#access_token=at&refresh_token=rt&expires_in=3600&token_type=bearer&type=recovery");
    mount(true);
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
    expect(auth.setSession).toHaveBeenCalledTimes(1);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
    expect(window.location.href).not.toContain("access_token");
  });

  it("Supabase rejected the link before redirecting (#error_code=otp_expired) → expired, no SDK calls", async () => {
    visit("/auth/callback?next=/auth/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    mount();
    expect(await screen.findByText(EXPIRED)).toBeTruthy();
    expect(Object.values(auth).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("reloaded after verification (already signed in) continues instead of erroring", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    visit("/auth/callback?next=/auth/update-password");
    mount();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/auth/update-password"));
    expect(screen.queryByText(EXPIRED)).toBeNull();
  });

  it("no link and no session → incomplete-link message", async () => {
    visit("/auth/callback");
    mount();
    expect(await screen.findByText("This link is incomplete")).toBeTruthy();
  });
});
