import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

const NOT_BRANDS = new Set(["used", "search", "browse", "category", "brands", "lessons", "rentals"]);

/**
 * guitarcenter.com/{Brand}/{slug}-{item number}.gc — kept hint-only (automated
 * access is inconsistently blocked). A trailing number of 6+ digits is Guitar
 * Center's item number: it becomes the SKU and is removed from the title.
 */
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
    const item = /^(.*?)-(\d{6,})$/.exec(m[2]);
    return cleanFields({ brand, sku: item?.[2], title: titleFromSlug(item ? item[1] : m[2]) });
  },
};

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
