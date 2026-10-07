"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FORM_TOKEN_PATTERN } from "@/lib/data/form-context";
import { lookupProduct, type LookupResult } from "@/lib/product/lookup";
import { signLookupToken } from "@/lib/product/lookup-token";
import { LOOKUP_RATE_LIMITS, type ProductLookupResponse } from "@/lib/product/types";
import { canonicalProductUrl, checkProductUrl } from "@/lib/product/url";
import type { ActionResult } from "@/lib/action-result";
import { clientFingerprint } from "./fingerprint";

const INVALID_URL = "Enter a full web address starting with https://";
const RATE_LIMITED = "Too many lookups right now. Please complete the details below.";

/**
 * "Get details" for one line item. Best effort: a blocked, slow or unhelpful
 * vendor still returns a (domain-only) result, never an exception. Vendor HTML
 * never reaches the browser — only cleaned text fields and a signed token.
 */
export async function getProductDetails(formToken: string, url: string): Promise<ActionResult<ProductLookupResponse>> {
  if (typeof formToken !== "string" || !FORM_TOKEN_PATTERN.test(formToken)) return { ok: false, error: "This requisition link is invalid." };
  if (typeof url !== "string" || !checkProductUrl(url).ok) return { ok: false, error: INVALID_URL };

  const admin = createSupabaseAdminClient();
  const { data: tokenId } = await admin.rpc("resolve_form_token_id", { p_token: formToken });
  if (!tokenId) return { ok: false, error: "This requisition link is invalid or has expired." };

  const allow = async (bucket: string, max: number) => {
    const { data, error } = await admin.rpc("consume_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: LOOKUP_RATE_LIMITS.windowSeconds });
    return !error && data === true;
  };
  if (!(await allow(`product:token:${tokenId}`, LOOKUP_RATE_LIMITS.perLink))) return { ok: false, error: RATE_LIMITED };
  if (!(await allow(`product:fp:${await clientFingerprint()}`, LOOKUP_RATE_LIMITS.perClient))) return { ok: false, error: RATE_LIMITED };

  const host = checkProductUrl(url);
  const fallbackDomain = host.ok ? host.host.replace(/^www\./, "") : "";
  try {
    const looked = await lookupProduct(url, { beforeNetwork: (domain) => allow(`product:domain:${domain}`, LOOKUP_RATE_LIMITS.perDomain) });
    if (!looked.ok) return { ok: false, error: INVALID_URL };
    const r = looked.result;
    logIncompleteLookup(r);
    const token = r.method
      ? signLookupToken({ fid: String(tokenId), url: canonicalProductUrl(url)!, dom: r.domain, m: r.method, at: Date.now(), f: r.fields, p: r.price, c: r.currency })
      : null;
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
