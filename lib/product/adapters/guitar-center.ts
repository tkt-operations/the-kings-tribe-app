import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

const NOT_BRANDS = new Set(["used", "search", "browse", "category", "brands", "lessons", "rentals"]);

/** guitarcenter.com/{Brand}/{slug}.gc — blocks automated retrieval. */
export const guitarCenter: VendorAdapter = {
  id: "guitar-center",
  displayName: "Guitar Center",
  domains: ["guitarcenter.com"],
  fetchPage: false,
  hints(url) {
    const m = /^\/([^/]+)\/([^/]+)\.gc$/i.exec(url.pathname);
    if (!m) return {};
    const brandSegment = decodeURIComponentSafe(m[1]);
    const brand = NOT_BRANDS.has(brandSegment.toLowerCase()) ? undefined : brandSegment.replace(/[-_]+/g, " ");
    return cleanFields({ brand, title: titleFromSlug(m[2]) });
  },
};

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
