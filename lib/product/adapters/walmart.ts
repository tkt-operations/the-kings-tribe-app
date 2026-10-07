import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** walmart.com/ip/{slug}/{itemId} — the page is tried (it usually exposes a title only). */
export const walmart: VendorAdapter = {
  id: "walmart",
  displayName: "Walmart",
  domains: ["walmart.com"],
  fetchPage: true,
  hints(url) {
    const m = /^\/ip\/(?:([^/]+)\/)?(\d{4,15})(?=[/?]|$)/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[2], title: titleFromSlug(m[1]) });
  },
};
