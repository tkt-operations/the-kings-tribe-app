/**
 * Open Graph / product meta fallback. Generic Open Graph (og:title on any
 * page) is NOT product information: it is used only when the page declares
 * itself a product (og:type product…) or carries product-specific tags
 * (product:price:*, product:brand, product:retailer_item_id, og:price:*).
 * Prices follow the same rules as structured data (USD only).
 */
import type { ExtractedProduct } from "@/lib/product/jsonld";
import { cleanFields, normalizePrice } from "@/lib/product/normalize";

const PRODUCT_TAGS = ["product:price:amount", "product:brand", "product:retailer_item_id", "og:price:amount", "og:brand"];

/** Does the page's meta establish it as a product page? */
export function isProductMeta(meta: Map<string, string>): boolean {
  const type = (meta.get("og:type") ?? "").trim().toLowerCase();
  if (type === "product" || type.startsWith("product.") || type === "og:product") return true;
  return PRODUCT_TAGS.some((tag) => (meta.get(tag) ?? "").trim() !== "");
}

export function extractFromMeta(meta: Map<string, string>): ExtractedProduct | null {
  if (!isProductMeta(meta)) return null;
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
