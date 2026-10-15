"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FORM_TOKEN_PATTERN } from "@/lib/data/form-context";
import { LOOKUP_INVALID_URL, LOOKUP_RATE_LIMITED, runProductLookup } from "@/lib/product/lookup-service";
import { signLookupToken } from "@/lib/product/lookup-token";
import { LOOKUP_RATE_LIMITS, type ProductLookupResponse } from "@/lib/product/types";
import { canonicalProductUrl, checkProductUrl } from "@/lib/product/url";
import type { ActionResult } from "@/lib/action-result";
import { clientFingerprint } from "./fingerprint";

/**
 * "Get details" for one line item. Best effort: a blocked, slow or unhelpful
 * vendor still returns a (domain-only) result, never an exception. Vendor HTML
 * never reaches the browser — only cleaned text fields and a signed token.
 */
export async function getProductDetails(formToken: string, url: string): Promise<ActionResult<ProductLookupResponse>> {
  if (typeof formToken !== "string" || !FORM_TOKEN_PATTERN.test(formToken)) return { ok: false, error: "This requisition link is invalid." };
  if (typeof url !== "string" || !checkProductUrl(url).ok) return { ok: false, error: LOOKUP_INVALID_URL };

  const admin = createSupabaseAdminClient();
  const { data: tokenId } = await admin.rpc("resolve_form_token_id", { p_token: formToken });
  if (!tokenId) return { ok: false, error: "This requisition link is invalid or has expired." };

  const allow = async (bucket: string, max: number) => {
    const { data, error } = await admin.rpc("consume_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: LOOKUP_RATE_LIMITS.windowSeconds });
    return !error && data === true;
  };
  if (!(await allow(`product:token:${tokenId}`, LOOKUP_RATE_LIMITS.perLink))) return { ok: false, error: LOOKUP_RATE_LIMITED };
  if (!(await allow(`product:fp:${await clientFingerprint()}`, LOOKUP_RATE_LIMITS.perClient))) return { ok: false, error: LOOKUP_RATE_LIMITED };

  return runProductLookup(url, allow, (r) =>
    signLookupToken({ fid: String(tokenId), url: canonicalProductUrl(url)!, dom: r.domain, m: r.method!, at: Date.now(), f: r.fields, p: r.price, c: r.currency }));
}
