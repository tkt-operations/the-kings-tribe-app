import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** homedepot.com/p/{slug}/{internet number} — blocks automated retrieval. */
export const homeDepot: VendorAdapter = {
  id: "home-depot",
  displayName: "Home Depot",
  domains: ["homedepot.com"],
  fetchPage: false,
  hints(url) {
    // Exactly /p/{slug}/{number} or /p/{number} (not /p/reviews/… or /p/questions/…).
    const m = /^\/p\/(?:([^/]+)\/)?(\d{6,12})\/?$/.exec(url.pathname);
    if (!m || m[1] === "reviews" || m[1] === "questions") return {};
    return cleanFields({ sku: m[2], title: titleFromSlug(m[1]) });
  },
};
