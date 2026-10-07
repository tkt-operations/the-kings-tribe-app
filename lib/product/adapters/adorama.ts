import { cleanFields } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** adorama.com/{item}.html — blocks automated retrieval. The link carries only Adorama's item code (no title). */
export const adorama: VendorAdapter = {
  id: "adorama",
  displayName: "Adorama",
  domains: ["adorama.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/([A-Za-z0-9]{3,40})\.html$/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[1] });
  },
};
