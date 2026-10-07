import type { VendorAdapter } from "./types";

/** Any other website: a safe structured-data attempt, no link hints. */
export const generic: VendorAdapter = {
  id: "generic",
  displayName: "",
  domains: [],
  fetchPage: true,
  hints: () => ({}),
  variantSku(url) {
    const v = url.searchParams.get("variant") ?? url.searchParams.get("sku") ?? url.searchParams.get("skuId");
    return v && /^[\w.-]{1,64}$/.test(v) ? v : null;
  },
};
