import { cleanFields, titleFromSlug } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/**
 * bestbuy.com/site/{slug}/{sku}.p?skuId={sku} — the website blocks automated
 * retrieval; the official Products API is a later phase (not used in V1).
 */
export const bestBuy: VendorAdapter = {
  id: "best-buy",
  displayName: "Best Buy",
  domains: ["bestbuy.com"],
  fetchPage: false,
  hints(url) {
    const site = /^\/site\/(?:([^/]+)\/)?(\d{5,9})\.p$/i.exec(url.pathname);
    const product = /^\/product\/([^/]+)/i.exec(url.pathname);
    const querySku = url.searchParams.get("skuId");
    const sku = site?.[2] ?? (querySku && /^\d{5,9}$/.test(querySku) ? querySku : undefined);
    return cleanFields({ sku, title: titleFromSlug(site?.[1] ?? product?.[1]) });
  },
};
