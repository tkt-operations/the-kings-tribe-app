import "server-only";

import { findAdapter, generic } from "@/lib/product/adapters";
import { extractJsonLdBlocks, extractMetaTags } from "@/lib/product/html-extract";
import { extractProductFromJsonLd, type ExtractedProduct } from "@/lib/product/jsonld";
import { extractFromMeta } from "@/lib/product/open-graph";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "@/lib/product/safe-fetch";
import { PRODUCT_FIELD_KEYS, type LookupMethod, type LookupOutcome, type PriceNote, type ProductFields } from "@/lib/product/types";
import { checkProductUrl, displayDomain } from "@/lib/product/url";

/**
 * Product link → identify vendor → (only if that vendor's pages may be
 * requested) one safe fetch → JSON-LD, then Open Graph → link hints →
 * whatever we found. Never throws; never bypasses bot protection.
 */

export interface LookupResult {
  outcome: LookupOutcome;
  domain: string;
  method: LookupMethod | null;
  fields: ProductFields;
  price: string | null;
  currency: string | null;
  priceNote: PriceNote | null;
  /** The normalised link that was looked up (what a token is bound to). */
  normalizedUrl: string;
}

export interface LookupDeps {
  fetch?: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** Called before any network request to `domain`; return false to skip it (rate limit). */
  beforeNetwork?: (domain: string) => Promise<boolean>;
  fetchOptions?: SafeFetchOptions;
}

export type LookupFailure = { ok: false; reason: "invalid_url" };

export async function lookupProduct(rawUrl: string, deps: LookupDeps = {}): Promise<{ ok: true; result: LookupResult } | LookupFailure> {
  const checked = checkProductUrl(rawUrl);
  if (!checked.ok) return { ok: false, reason: "invalid_url" };
  const doFetch = deps.fetch ?? safeFetch;
  const allowed = deps.beforeNetwork ?? (async () => true);

  let adapter = findAdapter(checked.host);
  let hintUrl: URL | null = checked.url;
  let domain = displayDomain(checked.host);

  if (adapter.resolveRedirects) {
    // Short link: follow redirects only (no page body), then use the target's hints.
    hintUrl = null;
    if (await allowed(domain)) {
      const resolved = await safeCall(() => doFetch(checked.normalized, { ...deps.fetchOptions, mode: "redirects" }));
      if (resolved?.ok) {
        const target = findAdapter(resolved.finalUrl.hostname);
        if (target !== generic) {
          adapter = target;
          hintUrl = resolved.finalUrl;
          domain = displayDomain(resolved.finalUrl.hostname);
        }
      }
    }
  }

  const hints = hintUrl ? adapter.hints(hintUrl) : {};
  let structured: ExtractedProduct | null = null;
  let meta: ExtractedProduct | null = null;

  if (adapter.fetchPage && !adapter.resolveRedirects && (await allowed(domain))) {
    const page = await safeCall(() => doFetch(checked.normalized, { ...deps.fetchOptions, mode: "page" }));
    if (page?.ok) {
      const variant = (adapter.variantSku ?? generic.variantSku)?.(checked.url) ?? null;
      structured = extractProductFromJsonLd(extractJsonLdBlocks(page.body), variant);
      meta = extractFromMeta(extractMetaTags(page.body));
    }
  }

  const vendorName = adapter.displayName || meta?.fields.vendor_name || undefined;
  const fields: ProductFields = {};
  for (const key of PRODUCT_FIELD_KEYS) {
    const value = structured?.fields[key] ?? meta?.fields[key] ?? hints[key];
    if (value) fields[key] = value;
  }
  if (vendorName) fields.vendor_name = vendorName;

  const price = structured?.price ?? (structured?.priceNote ? null : meta?.price) ?? null;
  const currency = price ? "USD" : null;
  const priceNote = price ? null : (structured?.priceNote ?? meta?.priceNote ?? null);

  const hasContent = (p: ExtractedProduct | null) =>
    Boolean(p && (p.price || PRODUCT_FIELD_KEYS.some((k) => k !== "vendor_name" && p.fields[k])));
  const method: LookupMethod | null = hasContent(structured)
    ? "structured_data"
    : hasContent(meta)
      ? "open_graph"
      : Object.keys(hints).length > 0 || adapter !== generic
        ? "url_hint"
        : null;

  const outcome: LookupOutcome =
    method === "structured_data" || method === "open_graph"
      ? fields.title && price ? "full" : "partial"
      : method === "url_hint"
        ? "hints"
        : "domain";

  return {
    ok: true,
    result: {
      outcome,
      domain,
      method,
      fields,
      price: method === "url_hint" ? null : price,
      currency: method === "url_hint" ? null : currency,
      priceNote: method === "url_hint" ? null : priceNote,
      normalizedUrl: checked.normalized,
    },
  };
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
