import { cleanFields } from "@/lib/product/normalize";
import type { VendorAdapter } from "./types";

/** monoprice.com/product?p_id={number} — blocks automated retrieval. The link carries only the product number. */
export const monoprice: VendorAdapter = {
  id: "monoprice",
  displayName: "Monoprice",
  domains: ["monoprice.com"],
  fetchPage: false,
  hints(url) {
    if (!/^\/product\/?$/i.test(url.pathname)) return {};
    const id = url.searchParams.get("p_id") ?? url.searchParams.get("P_ID");
    return id && /^\d{2,10}$/.test(id) ? cleanFields({ sku: id }) : {};
  },
};
