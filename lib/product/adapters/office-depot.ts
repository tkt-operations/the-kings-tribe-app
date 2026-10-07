import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** officedepot.com/a/products/{item}/{slug}/ — bot protection holds automated requests open, so pages are never requested. */
export const officeDepot: VendorAdapter = {
  id: "office-depot",
  displayName: "Office Depot",
  domains: ["officedepot.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/a\/products\/(\d{3,12})(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[1], title: titleFromSlug(m[2]) });
  },
};
