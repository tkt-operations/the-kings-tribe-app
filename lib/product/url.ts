/**
 * Product link parsing. Client-safe (no Node imports) so the form and the
 * server apply the same rules. The server ALSO resolves and checks every IP
 * address before connecting (lib/product/safe-fetch.ts) — this module only
 * rejects links that are unacceptable on their face.
 */

export const PRODUCT_URL_MAX_LENGTH = 2048;

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

export type ProductUrlCheck =
  | { ok: true; url: URL; normalized: string; host: string }
  | { ok: false; reason: "empty" | "invalid" | "not_https" | "credentials" | "port" | "ip_address" | "host" | "too_long" };

/**
 * Only `https://` links on the default port, with a public-looking hostname
 * (no IP addresses in any notation, no single-label or internal names, no
 * user:password@). The fragment is dropped.
 */
export function checkProductUrl(input: string): ProductUrlCheck {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length > PRODUCT_URL_MAX_LENGTH) return { ok: false, reason: "too_long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "port" };
  // The WHATWG parser rewrites every IPv4 spelling (0x7f.1, 2130706433, 127.1…)
  // to dotted decimal, so these two patterns catch all IP-literal hosts.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, reason: "ip_address" };
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "host" };
  }
  if (host.length > 253 || host.split(".").some((label) => label.length === 0 || label.length > 63)) return { ok: false, reason: "host" };
  url.hash = "";
  url.hostname = host;
  return { ok: true, url, normalized: url.href, host };
}

/** The canonical form used to bind a lookup to the link it was made for. */
export function canonicalProductUrl(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.href;
  } catch {
    return null;
  }
}

/** Domain shown and stored for a lookup: lowercase host without "www.". */
export function displayDomain(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** Does `host` belong to `domain` (exactly, or a subdomain of it)? */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}
