/**
 * schema.org Product data from JSON-LD. Reads name, brand, sku, model/mpn,
 * color, size and — only when it is unambiguous — a USD price.
 */
import { parseJsonLd } from "@/lib/product/html-extract";
import { cleanFields, normalizePrice } from "@/lib/product/normalize";
import type { PriceNote, ProductFields } from "@/lib/product/types";

export interface ExtractedProduct {
  fields: ProductFields;
  price: string | null;
  currency: string | null;
  priceNote: PriceNote | null;
}

type Node = Record<string, unknown>;
const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct", "productmodel"]);
const MAX_NODES = 500;
const MAX_DEPTH = 8;

function isObject(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function types(node: Node): string[] {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase());
}

function isProduct(node: Node): boolean {
  return types(node).some((t) => PRODUCT_TYPES.has(t));
}

/** Every Product-like node in the parsed documents (bounded walk). */
function collectProducts(roots: unknown[]): Node[] {
  const found: Node[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number) => {
    if (visited++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    if (isProduct(value)) found.push(value);
    if (value["@graph"]) walk(value["@graph"], depth + 1);
    if (value.mainEntity) walk(value.mainEntity, depth + 1);
    if (value.itemListElement) walk(value.itemListElement, depth + 1);
    if (isObject(value.item)) walk(value.item, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return found;
}

function textOf(value: unknown): unknown {
  if (Array.isArray(value)) return textOf(value[0]);
  if (isObject(value)) return value.name ?? value["@value"];
  return value;
}

function variantsOf(node: Node): Node[] {
  const v = node.hasVariant;
  return (Array.isArray(v) ? v : [v]).filter(isObject).filter(isProduct);
}

interface PriceCandidate {
  price: string;
  currency: string;
}

/** Offer / AggregateOffer / priceSpecification → candidate prices. */
function offerPrices(offers: unknown, out: PriceCandidate[], ranges: { found: boolean }, depth = 0): void {
  if (depth > 4 || offers === undefined || offers === null) return;
  if (Array.isArray(offers)) {
    for (const o of offers.slice(0, 50)) offerPrices(o, out, ranges, depth + 1);
    return;
  }
  if (!isObject(offers)) return;
  const kind = types(offers);
  if (kind.includes("aggregateoffer")) {
    const low = normalizePrice(offers.lowPrice);
    const high = normalizePrice(offers.highPrice ?? offers.lowPrice);
    const currency = String(offers.priceCurrency ?? "").trim().toUpperCase();
    if (low !== null && high !== null && low === high) {
      out.push({ price: low, currency });
    } else if (offers.offers) {
      offerPrices(offers.offers, out, ranges, depth + 1);
    } else if (low !== null || high !== null) {
      ranges.found = true;
    }
    return;
  }
  let price = offers.price;
  let currency = offers.priceCurrency;
  if ((price === undefined || price === null) && offers.priceSpecification) {
    const specs = Array.isArray(offers.priceSpecification) ? offers.priceSpecification : [offers.priceSpecification];
    const spec = specs.find((s) => isObject(s) && s.price !== undefined) as Node | undefined;
    price = spec?.price;
    currency = currency ?? spec?.priceCurrency;
  }
  const normalized = normalizePrice(price);
  if (normalized !== null) out.push({ price: normalized, currency: String(currency ?? "").trim().toUpperCase() });
}

/** One distinct USD price → that price; otherwise none, with the reason. */
function choosePrice(candidates: PriceCandidate[], ranged: boolean): Pick<ExtractedProduct, "price" | "currency" | "priceNote"> {
  if (candidates.length === 0) return { price: null, currency: null, priceNote: ranged ? "multiple" : null };
  if (candidates.some((c) => c.currency !== "USD")) return { price: null, currency: null, priceNote: "currency" };
  const distinct = new Set(candidates.map((c) => c.price));
  if (distinct.size !== 1 || ranged) return { price: null, currency: null, priceNote: "multiple" };
  return { price: candidates[0].price, currency: "USD", priceNote: null };
}

function fieldsOf(node: Node): ProductFields {
  return cleanFields({
    title: textOf(node.name),
    brand: textOf(node.brand) ?? textOf(node.manufacturer),
    model: textOf(node.model) ?? node.mpn,
    sku: node.sku,
    color: textOf(node.color),
    size: textOf(node.size),
  });
}

/**
 * Extract the page's product. `variantSku` (from the link, e.g. ?skuId=…)
 * selects a matching variant of a ProductGroup.
 */
export function extractProductFromJsonLd(blocks: string[], variantSku?: string | null): ExtractedProduct | null {
  const products = collectProducts(blocks.map(parseJsonLd).filter((x) => x !== undefined));
  if (products.length === 0) return null;

  // Prefer a product node that carries offers.
  let node = products.find((p) => p.offers !== undefined) ?? products[0];
  let fields = fieldsOf(node);

  const variants = variantsOf(node);
  if (variants.length > 0) {
    const match =
      (variantSku && variants.find((v) => String(v.sku ?? "") === variantSku)) || (variants.length === 1 ? variants[0] : undefined);
    if (match) {
      fields = { ...fields, ...fieldsOf(match) };
      node = match;
    }
  }

  const candidates: PriceCandidate[] = [];
  const ranges = { found: false };
  if (node.offers !== undefined) {
    offerPrices(node.offers, candidates, ranges);
  } else if (variants.length > 1) {
    for (const v of variants.slice(0, 50)) offerPrices(v.offers, candidates, ranges);
  }
  return { fields, ...choosePrice(candidates, ranges.found) };
}
