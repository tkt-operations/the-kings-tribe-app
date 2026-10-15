import "server-only";

import type { ActionResult } from "@/lib/action-result";
import { lookupProduct, type LookupResult } from "@/lib/product/lookup";
import { LOOKUP_RATE_LIMITS, type ProductLookupResponse } from "@/lib/product/types";
import { checkProductUrl } from "@/lib/product/url";

export const LOOKUP_INVALID_URL = "Enter a full web address starting with https://";
export const LOOKUP_RATE_LIMITED = "Too many lookups right now. Please complete the details below.";

/** Rate-limit check: true when the request may go ahead. */
export type AllowFn = (bucket: string, max: number) => Promise<boolean>;

/**
 * The best-effort product lookup shared by every "Get details" button (the
 * external request form and staff amendments). All network safety lives in
 * lookupProduct / safe-fetch (SSRF-safe fetch, timeouts, size limits, no
 * bot-protection bypass); vendor HTML never leaves the server — only cleaned
 * text fields. A blocked, slow or unhelpful vendor still returns a
 * (domain-only) result, never an exception. Callers check who may look up and
 * apply their own rate limits first; `sign` issues the submission token, or
 * returns null where none is recorded (amendments).
 */
export async function runProductLookup(
  url: string,
  allow: AllowFn,
  sign: (result: LookupResult) => string | null,
): Promise<ActionResult<ProductLookupResponse>> {
  const host = checkProductUrl(url);
  if (!host.ok) return { ok: false, error: LOOKUP_INVALID_URL };
  const fallbackDomain = host.host.replace(/^www\./, "");
  try {
    const looked = await lookupProduct(url, { beforeNetwork: (domain) => allow(`product:domain:${domain}`, LOOKUP_RATE_LIMITS.perDomain) });
    if (!looked.ok) return { ok: false, error: LOOKUP_INVALID_URL };
    const r = looked.result;
    logIncompleteLookup(r);
    const token = r.method ? sign(r) : null;
    return {
      ok: true,
      data: { outcome: r.outcome, domain: r.domain, method: r.method, fields: r.fields, price: r.price, currency: r.currency, priceNote: r.priceNote, token },
    };
  } catch (error) {
    console.warn("product lookup failed", { domain: fallbackDomain, error: (error as Error)?.name ?? "Error" });
    return { ok: true, data: { outcome: "domain", domain: fallbackDomain, method: null, fields: {}, price: null, currency: null, priceNote: null, token: null } };
  }
}

/**
 * Minimal operational log for lookups that did not reach usable product data.
 * Hostname-level domain, vendor adapter, outcome and network facts only —
 * never the full URL, path or query, IP address, token or requester details.
 */
function logIncompleteLookup(r: LookupResult) {
  const { diagnostics: d } = r;
  if (r.outcome !== "domain" && (d.network === "none" || d.network === "ok")) return;
  console.warn("product lookup incomplete", {
    domain: r.domain, vendor: d.vendor, outcome: r.outcome, method: r.method,
    network: d.network, stage: d.stage, status: d.status, ms: d.ms,
  });
}
