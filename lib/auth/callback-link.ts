/**
 * Auth email/admin links that land on /auth/callback.
 *
 * Canonical (new) format — the one-time token travels in the URL FRAGMENT:
 *
 *   https://ops.example.org/auth/callback?next=/auth/update-password#token_hash=<hash>&type=recovery
 *
 * Fragments are never sent to the server, so the token cannot appear in server
 * or proxy logs, Referer headers, or a crawler's HEAD/GET request. The callback
 * page only verifies it after the person presses "Continue" (see
 * app/auth/callback/auth-callback.tsx), so link-preview bots that fetch — or
 * even render — the page cannot use it up.
 *
 * Also accepted, for links already sent and during the email-template rollout:
 *   ?token_hash=…&type=…   (query form; same explicit "Continue" step)
 *   ?code=…[&sb_flow_id=…] (PKCE; exchanged once, needs this browser's verifier)
 *   #access_token=…        (implicit; raw Supabase /verify links)
 *   #error_code=…          (Supabase rejected the link before redirecting)
 */

export type SetupLinkType = "invite" | "recovery";
export const SETUP_LINK_TYPES: readonly SetupLinkType[] = ["invite", "recovery"];

/** The only place an auth link may send someone afterwards. */
export const DEFAULT_CALLBACK_NEXT = "/auth/update-password";
const NEXT_ALLOWLIST = new Set([DEFAULT_CALLBACK_NEXT]);

export function callbackNext(raw: string | null | undefined): string {
  return raw && NEXT_ALLOWLIST.has(raw) ? raw : DEFAULT_CALLBACK_NEXT;
}

// Supabase token hashes are hex digests, optionally prefixed "pkce_".
const TOKEN_HASH = /^(pkce_)?[0-9a-f]{40,128}$/i;
const CODE = /^[0-9a-zA-Z-]{8,128}$/;

export type AuthLink =
  | { kind: "token_hash"; tokenHash: string; type: SetupLinkType }
  | { kind: "code"; code: string; flowId: string | null }
  | { kind: "implicit"; accessToken: string; refreshToken: string }
  | { kind: "error"; reason: "expired" | "rejected" }
  | { kind: "malformed" }
  | { kind: "none" };

/** Shape checks only — nothing here contacts Supabase or consumes anything. */
export function parseAuthLink(search: URLSearchParams, hash: URLSearchParams): AuthLink {
  const errorCode = hash.get("error_code") ?? search.get("error_code");
  if (errorCode || hash.get("error") || search.get("error")) {
    return { kind: "error", reason: errorCode === "otp_expired" ? "expired" : "rejected" };
  }

  const tokenHash = hash.get("token_hash") ?? search.get("token_hash");
  if (tokenHash !== null) {
    const type = hash.get("type") ?? search.get("type");
    if (!TOKEN_HASH.test(tokenHash) || !SETUP_LINK_TYPES.includes(type as SetupLinkType)) return { kind: "malformed" };
    return { kind: "token_hash", tokenHash, type: type as SetupLinkType };
  }

  const code = search.get("code");
  if (code !== null) {
    if (!CODE.test(code)) return { kind: "malformed" };
    return { kind: "code", code, flowId: search.get("sb_flow_id") };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken || refreshToken) {
    if (!accessToken || !refreshToken) return { kind: "malformed" };
    return { kind: "implicit", accessToken, refreshToken };
  }
  return { kind: "none" };
}

/**
 * The link an administrator sends: our own callback, never Supabase's raw
 * /verify action_link (which a preview bot consumes with a single GET).
 */
export function buildSetupLink(appUrl: string, tokenHash: string, type: SetupLinkType): string {
  if (!TOKEN_HASH.test(tokenHash)) throw new Error("Unexpected token hash format.");
  const fragment = new URLSearchParams({ token_hash: tokenHash, type }).toString();
  return `${appUrl.replace(/\/+$/, "")}/auth/callback?next=${DEFAULT_CALLBACK_NEXT}#${fragment}`;
}

export type CallbackFailure = "expired" | "malformed" | "other_browser" | "rate_limited" | "failed";

/** Map an SDK/Auth error to a safe category. Raw messages are never shown. */
export function classifyAuthError(error: unknown): CallbackFailure {
  const e = (error ?? {}) as { code?: string; status?: number; name?: string };
  if (e.name === "AuthPKCECodeVerifierMissingError" || e.code === "pkce_code_verifier_not_found") return "other_browser";
  if (e.status === 429 || e.code === "over_request_rate_limit" || e.code === "over_email_send_rate_limit") return "rate_limited";
  if (e.code === "otp_expired" || e.code === "flow_state_expired" || e.code === "flow_state_not_found" || e.status === 403 || e.status === 404) return "expired";
  if (e.code === "validation_failed" || e.status === 400 || e.status === 422) return "malformed";
  return "failed";
}
