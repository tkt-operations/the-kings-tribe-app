import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** sweetwater.com/store/detail/{ItemID}--{slug} — blocks automated retrieval. */
export const sweetwater: VendorAdapter = {
  id: "sweetwater",
  displayName: "Sweetwater",
  domains: ["sweetwater.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/store\/detail\/([A-Za-z0-9]+)(?:--([^/]+))?/.exec(url.pathname);
    if (!m) return {};
    return cleanFields({ sku: m[1], title: titleFromSlug(m[2]) });
  },
};
