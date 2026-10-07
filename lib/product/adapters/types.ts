import type { ProductFields } from "@/lib/product/types";

/**
 * One small, isolated adapter per vendor. Vendor knowledge lives ONLY here:
 * which domains it covers, whether its pages may be fetched, and what its
 * link addresses reveal. No adapter scrapes vendor-specific HTML.
 */
export interface VendorAdapter {
  id: string;
  /** Shown and prefilled as the vendor name ("" for the generic adapter). */
  displayName: string;
  domains: readonly string[];
  /**
   * false for vendors whose bot protection blocks automated retrieval
   * (we never try to get around it, so we do not request their pages at all).
   */
  fetchPage: boolean;
  /** Short-link domains: follow redirects only (no page body), then use hints. */
  resolveRedirects?: boolean;
  /** Details readable from the link itself (no network). */
  hints(url: URL): ProductFields;
  /** Variant identifier in the link, used to pick a ProductGroup variant. */
  variantSku?(url: URL): string | null;
}
