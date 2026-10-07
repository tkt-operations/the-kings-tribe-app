import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/asin)\/([A-Z0-9]{10})(?=[/?]|$)/i;

/** Amazon product links (ASIN). Pages are not requested (no usable product data, and terms forbid scraping). */
export const amazon: VendorAdapter = {
  id: "amazon",
  displayName: "Amazon",
  domains: ["amazon.com", "amazon.ca", "amazon.co.uk"],
  fetchPage: false,
  hints(url) {
    const m = ASIN.exec(url.pathname);
    if (!m) return {};
    const before = url.pathname.slice(0, m.index).split("/").filter(Boolean);
    const slug = before.length === 1 ? before[0] : undefined;
    return cleanFields({ sku: m[1].toUpperCase(), title: titleFromSlug(slug) });
  },
};

/** amzn.to / a.co short links: redirects are followed (headers only), then the Amazon hints apply. */
export const amazonShortLink: VendorAdapter = {
  id: "amazon-short",
  displayName: "Amazon",
  domains: ["amzn.to", "a.co", "amzn.com"],
  fetchPage: false,
  resolveRedirects: true,
  hints: () => ({}),
};
