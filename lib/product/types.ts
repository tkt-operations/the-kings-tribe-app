/**
 * Product URL auto-fill (V1) — shared types. Client-safe: no server imports.
 *
 * A lookup is best-effort enrichment. Whatever it finds prefills EMPTY line
 * fields; the requester reviews and completes the rest. Manual entry always
 * remains available and a failed lookup never blocks submission.
 */

export const LOOKUP_METHODS = ["structured_data", "open_graph", "url_hint"] as const;
export type LookupMethod = (typeof LOOKUP_METHODS)[number];

/** Text values a lookup can return (all optional, already cleaned). */
export interface ProductFields {
  title?: string;
  brand?: string;
  model?: string;
  sku?: string;
  vendor_name?: string;
  color?: string;
  size?: string;
}

export const PRODUCT_FIELD_KEYS = ["title", "brand", "model", "sku", "vendor_name", "color", "size"] as const satisfies readonly (keyof ProductFields)[];

/** Column limits shared with the database (migration 20261008000100). */
export const PRODUCT_FIELD_MAX: Record<keyof ProductFields, number> = {
  title: 300,
  brand: 120,
  model: 100,
  sku: 100,
  vendor_name: 200,
  color: 60,
  size: 60,
};

/**
 * full     — title and a reliable price
 * partial  — some details from the page itself
 * hints    — only what the link's address tells us (known vendor)
 * domain   — nothing beyond the website's domain
 */
export type LookupOutcome = "full" | "partial" | "hints" | "domain";

/** Why a price was left out even though the page mentioned one. */
export type PriceNote = "multiple" | "currency";

export interface ProductLookupResponse {
  outcome: LookupOutcome;
  domain: string;
  method: LookupMethod | null;
  fields: ProductFields;
  /** Canonical decimal ("849.99") in USD, or null. */
  price: string | null;
  currency: string | null;
  priceNote: PriceNote | null;
  /** Signed lookup token (only when method is not null). */
  token: string | null;
}

/** A signed lookup token is honoured for this long after the lookup. */
export const LOOKUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Tokens longer than this are never parsed. */
export const LOOKUP_TOKEN_MAX_LENGTH = 4096;

/** "Get details" rate limits (per hour): per form link, per client fingerprint, per vendor domain (all users). */
export const LOOKUP_RATE_LIMITS = { perLink: 30, perClient: 20, perDomain: 60, windowSeconds: 3600 } as const;
