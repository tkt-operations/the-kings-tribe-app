/**
 * Cleaning for every value taken from a vendor page or link. Output is plain
 * text only: entities decoded, tags and control characters removed,
 * whitespace collapsed, trimmed to the column limit. Client-safe.
 */
import { centsToDecimal, parseMoney } from "@/lib/money";
import { PRODUCT_FIELD_KEYS, PRODUCT_FIELD_MAX, type ProductFields } from "@/lib/product/types";

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  trade: "™", reg: "®", copy: "©", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", deg: "°", times: "×",
  frac12: "½", frac14: "¼", frac34: "¾", inch: "″", prime: "′", Prime: "″", bull: "•", middot: "·",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? match;
  });
}

/** Plain text, max `max` characters, or undefined when nothing is left. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return undefined;
  let text = decodeEntities(value.slice(0, max * 8));
  text = text.replace(/<[^>]*>/g, " ");
  text = decodeEntities(text); // double-encoded entities are common in feeds
  text = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, " ");
  text = text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}

/** Clean every field to its column limit, dropping empty ones. */
export function cleanFields(fields: Partial<Record<keyof ProductFields, unknown>>): ProductFields {
  const out: ProductFields = {};
  for (const key of PRODUCT_FIELD_KEYS) {
    const v = cleanText(fields[key], PRODUCT_FIELD_MAX[key]);
    if (v) out[key] = v;
  }
  return out;
}

export const MAX_REFERENCE_PRICE_CENTS = 1_000_000_000n; // 10,000,000.00 — same as the database

/** A price value from structured data → canonical "849.99", or null if not a plain, sane amount. */
export function normalizePrice(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    value = value.toFixed(2);
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^(US)?\$\s*/i, "");
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = parseMoney(text);
  if (cents === null || cents < 0n || cents > MAX_REFERENCE_PRICE_CENTS) return null;
  return centsToDecimal(cents);
}

/** "shure-sm58-cardioid" → "Shure SM58 Cardioid" (a suggestion only). */
export function titleFromSlug(slug: string | undefined | null, separator: RegExp = /[-_+]+/): string | undefined {
  if (!slug) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }
  const words = decoded.replace(/\.(html?|gc|p)$/i, "").split(separator).filter(Boolean);
  if (words.length === 0) return undefined;
  const title = words
    .map((w) => (/\d/.test(w) && /[a-z]/i.test(w) ? w.toUpperCase() : w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  const cleaned = cleanText(title, PRODUCT_FIELD_MAX.title);
  return cleaned && cleaned.length >= 3 ? cleaned : undefined;
}
