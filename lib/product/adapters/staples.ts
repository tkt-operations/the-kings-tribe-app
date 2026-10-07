import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** staples.com/{slug}/product_{item} — blocks automated retrieval. */
export const staples: VendorAdapter = {
  id: "staples",
  displayName: "Staples",
  domains: ["staples.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/(?:([^/]+)\/)?product_([A-Za-z0-9]{2,20})\/?$/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[2], title: titleFromSlug(m[1]) });
  },
};
