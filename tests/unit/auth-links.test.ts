/**
 * Auth link helpers, the browser client's single-owner configuration, and the
 * response headers that keep one-time tokens out of caches and Referer headers.
 */
import { describe, expect, it, vi } from "vitest";
import { buildSetupLink, callbackNext, classifyAuthError, parseAuthLink } from "@/lib/auth/callback-link";

const HASH = "d4".repeat(28);
const parse = (query: string, fragment = "") => parseAuthLink(new URLSearchParams(query), new URLSearchParams(fragment));

describe("buildSetupLink", () => {
  it("is our callback on the app host, with the token hash only in the fragment", () => {
    const link = buildSetupLink("https://ops.thekingstribe.org/", HASH, "recovery");
    expect(link).toBe(`https://ops.thekingstribe.org/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=recovery`);
    const url = new URL(link);
    // What a crawler's GET/HEAD request line contains: no token.
    expect(url.pathname + url.search).toBe("/auth/callback?next=/auth/update-password");
    expect(url.pathname + url.search).not.toContain(HASH);
  });

  it("keeps invite links as invite", () => {
    expect(buildSetupLink("https://ops.thekingstribe.org", HASH, "invite")).toContain("type=invite");
  });

  it("refuses anything that is not a Supabase token hash", () => {
    expect(() => buildSetupLink("https://ops.thekingstribe.org", "abc&next=//evil", "recovery")).toThrow();
  });

  it("round-trips through the callback parser", () => {
    const url = new URL(buildSetupLink("https://ops.thekingstribe.org", `pkce_${HASH}`, "recovery"));
    expect(parseAuthLink(url.searchParams, new URLSearchParams(url.hash.slice(1)))).toEqual({ kind: "token_hash", tokenHash: `pkce_${HASH}`, type: "recovery" });
  });
});

describe("parseAuthLink (shape only; consumes nothing)", () => {
  it.each([
    ["fragment token_hash", "next=/auth/update-password", `token_hash=${HASH}&type=invite`, { kind: "token_hash", tokenHash: HASH, type: "invite" }],
    ["query token_hash", `token_hash=${HASH}&type=recovery`, "", { kind: "token_hash", tokenHash: HASH, type: "recovery" }],
    ["PKCE code", "code=8f14e45f-ceea-4672-a1f2-2c1f5a4b9d10&sb_flow_id=f1", "", { kind: "code", code: "8f14e45f-ceea-4672-a1f2-2c1f5a4b9d10", flowId: "f1" }],
    ["implicit", "", "access_token=a&refresh_token=r", { kind: "implicit", accessToken: "a", refreshToken: "r" }],
    ["expired error", "", "error=access_denied&error_code=otp_expired", { kind: "error", reason: "expired" }],
    ["other error", "error=server_error", "", { kind: "error", reason: "rejected" }],
    ["bad type", "", `token_hash=${HASH}&type=signup`, { kind: "malformed" }],
    ["bad hash", "", "token_hash=zz&type=recovery", { kind: "malformed" }],
    ["half implicit", "", "access_token=a", { kind: "malformed" }],
    ["nothing", "next=/auth/update-password", "", { kind: "none" }],
  ] as const)("%s", (_label, query, fragment, expected) => {
    expect(parse(query, fragment)).toEqual(expected);
  });
});

describe("callbackNext allowlist", () => {
  it.each([
    ["/auth/update-password", "/auth/update-password"],
    ["/dashboard", "/auth/update-password"],
    ["https://evil.example", "/auth/update-password"],
    ["//evil.example", "/auth/update-password"],
    [null, "/auth/update-password"],
  ])("%s → %s", (raw, expected) => {
    expect(callbackNext(raw)).toBe(expected);
  });
});

describe("classifyAuthError", () => {
  it.each([
    [{ name: "AuthPKCECodeVerifierMissingError", code: "pkce_code_verifier_not_found", status: 400 }, "other_browser"],
    [{ code: "otp_expired", status: 403 }, "expired"],
    [{ code: "flow_state_not_found", status: 404 }, "expired"],
    [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
    [{ code: "validation_failed", status: 400 }, "malformed"],
    [{ code: "unexpected_failure", status: 500 }, "failed"],
    [null, "failed"],
  ] as const)("%j → %s", (error, expected) => {
    expect(classifyAuthError(error)).toBe(expected);
  });
});

describe("browser client: single owner of auth links", () => {
  it("disables the SDK's automatic URL session detection", async () => {
    const createBrowserClient = vi.fn(() => ({}));
    vi.doMock("@supabase/ssr", () => ({ createBrowserClient }));
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/browser");
    createSupabaseBrowserClient();
    expect(createBrowserClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), { auth: { detectSessionInUrl: false } });
    vi.doUnmock("@supabase/ssr");
  });
});

describe("/auth/callback response headers", () => {
  it("no Referer, no caching, no indexing", async () => {
    const { default: config } = await import("@/next.config");
    const rules = await config.headers!();
    const rule = rules.find((r) => r.source === "/auth/callback");
    expect(rule?.headers).toEqual(expect.arrayContaining([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]));
  });
});
