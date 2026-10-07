/**
 * Open Graph / product meta fallback: og:title, og:site_name, product:brand,
 * product:retailer_item_id and product:price:* (or og:price:*), with the same
 * price rules as structured data (USD only).
 */
import type { ExtractedProduct } from "@/lib/product/jsonld";
import { cleanFields, normalizePrice } from "@/lib/product/normalize";

export function extractFromMeta(meta: Map<string, string>): ExtractedProduct | null {
  const fields = cleanFields({
    title: meta.get("og:title"),
    vendor_name: meta.get("og:site_name"),
    brand: meta.get("product:brand") ?? meta.get("og:brand"),
    sku: meta.get("product:retailer_item_id"),
    color: meta.get("product:color"),
    size: meta.get("product:size"),
  });
  const rawPrice = meta.get("product:price:amount") ?? meta.get("og:price:amount");
  const currency = (meta.get("product:price:currency") ?? meta.get("og:price:currency") ?? "").trim().toUpperCase();
  const price = normalizePrice(rawPrice);
  let result: Pick<ExtractedProduct, "price" | "currency" | "priceNote"> = { price: null, currency: null, priceNote: null };
  if (price !== null) result = currency === "USD" ? { price, currency: "USD", priceNote: null } : { price: null, currency: null, priceNote: "currency" };
  if (Object.keys(fields).length === 0 && result.price === null) return null;
  return { fields, ...result };
}
