/** JSON-LD and Open Graph extraction, and text/price cleaning (recorded pages only). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractJsonLdBlocks, extractMetaTags, parseJsonLd } from "@/lib/product/html-extract";
import { extractProductFromJsonLd } from "@/lib/product/jsonld";
import { cleanText, decodeEntities, normalizePrice, titleFromSlug } from "@/lib/product/normalize";
import { extractFromMeta } from "@/lib/product/open-graph";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const fromJsonLd = (html: string, variant?: string) => extractProductFromJsonLd(extractJsonLdBlocks(html), variant);

describe("JSON-LD", () => {
  it("reads a full Product with a single USD offer", () => {
    expect(fromJsonLd(fixture("full-jsonld.html"))).toEqual({
      fields: { title: "Ergonomic Mesh Task Chair & Headrest", brand: "Realspace", model: "BX-200", sku: "5791037", color: "Black" },
      price: "249.99",
      currency: "USD",
      priceNote: null,
    });
  });

  it("handles @graph and picks the ProductGroup variant named in the link", () => {
    const html = fixture("graph-variants.html");
    expect(fromJsonLd(html, "SM-12")).toMatchObject({ fields: { title: 'Stage Monitor 12"', brand: "Acme Audio", sku: "SM-12", size: "12 in" }, price: "249.00" });
    // No variant chosen: group details, and no single price.
    expect(fromJsonLd(html)).toMatchObject({ fields: { title: "Stage Monitor", brand: "Acme Audio" }, price: null, priceNote: "multiple" });
  });

  it("gives no price when offers disagree", () => {
    expect(fromJsonLd(fixture("multiple-offers.html"))).toMatchObject({ fields: { title: "Wireless Microphone", brand: "Shure", model: "BLX24" }, price: null, priceNote: "multiple" });
  });

  it("gives no price in another currency", () => {
    expect(fromJsonLd(fixture("non-usd.html"))).toMatchObject({ fields: { title: "Mixer" }, price: null, currency: null, priceNote: "currency" });
  });

  it("skips malformed blocks and accepts an AggregateOffer with one price", () => {
    expect(fromJsonLd(fixture("malformed.html"))).toMatchObject({ fields: { title: "Second block works" }, price: "20.00", currency: "USD" });
  });

  it("treats an AggregateOffer range as ambiguous", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Cable","offers":{"@type":"AggregateOffer","lowPrice":"5","highPrice":"9","priceCurrency":"USD"}}</script>`;
    expect(fromJsonLd(html)).toMatchObject({ price: null, priceNote: "multiple" });
  });

  it("reads priceSpecification, numeric prices, schema.org URLs as types, and array types", () => {
    const html = `<script type="application/ld+json">[{"@type":["Thing","http://schema.org/Product"],"name":"Lamp","sku":12345,
      "offers":{"@type":"Offer","priceSpecification":{"@type":"UnitPriceSpecification","price":"1,299.5","priceCurrency":"USD"}}}]</script>`;
    expect(fromJsonLd(html)).toMatchObject({ fields: { title: "Lamp", sku: "12345" }, price: "1299.50" });
  });

  it("returns null without product data", () => {
    expect(fromJsonLd(fixture("no-metadata.html"))).toBeNull();
    expect(fromJsonLd(fixture("og-only.html"))).toBeNull();
  });

  it("caps the number and size of blocks", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<script type="application/ld+json">{"n":${i}}</script>`).join("");
    expect(extractJsonLdBlocks(many)).toHaveLength(20);
    const big = `<script type="application/ld+json">${" ".repeat(201 * 1024)}{}</script>`;
    expect(extractJsonLdBlocks(big)).toHaveLength(0);
  });

  it("does not choke on unterminated or adversarial markup", () => {
    const hostile = "<script type=application/ld+json>".repeat(50_000);
    const started = Date.now();
    expect(extractJsonLdBlocks(hostile)).toEqual([]);
    expect(extractMetaTags("<meta ".repeat(50_000))).toEqual(new Map());
    expect(Date.now() - started).toBeLessThan(2000);
    expect(parseJsonLd("<!-- {\"a\":1} -->")).toEqual({ a: 1 });
    expect(parseJsonLd("{nope")).toBeUndefined();
  });

  it("returns plain text only from hostile pages and drops an absurd price", () => {
    const html = fixture("hostile.html");
    const product = fromJsonLd(html)!;
    expect(product.fields.title).toBe("Camera alert(2) Kit");
    expect(product.fields.brand).toBe("Canon");
    expect(product.fields.sku).toBe("ABC 12");
    expect(product.price).toBeNull();
    for (const value of Object.values(product.fields)) expect(value).not.toMatch(/[<>]/);
    // A ">" inside a meta attribute ends the tag, so the markup-laden title is simply dropped.
    expect(extractFromMeta(extractMetaTags(html))?.fields.title).toBeUndefined();
    expect(extractFromMeta(extractMetaTags(`<meta property="og:title" content="&lt;b&gt;Safe&lt;/b&gt; title">`))?.fields.title).toBe("Safe title");
  });
});

describe("Open Graph fallback", () => {
  it("reads title, site name, brand and a USD price", () => {
    expect(extractFromMeta(extractMetaTags(fixture("og-only.html")))).toEqual({
      fields: { title: "Folding Table, 6 ft – White", vendor_name: "Example Store", brand: "Lifetime" },
      price: "59.00",
      currency: "USD",
      priceNote: null,
    });
  });

  it("ignores a price in another currency and pages without meta", () => {
    const meta = new Map([["og:title", "Thing"], ["product:price:amount", "10"], ["product:price:currency", "EUR"]]);
    expect(extractFromMeta(meta)).toMatchObject({ price: null, priceNote: "currency" });
    expect(extractFromMeta(extractMetaTags(fixture("no-metadata.html")))).toBeNull();
  });

  it("parses attribute quoting styles and keeps the first value", () => {
    const meta = extractMetaTags(`<META PROPERTY='og:title' CONTENT='One'><meta name=og:title content=Two><meta content="x" property="og:site_name">`);
    expect(meta.get("og:title")).toBe("One");
    expect(meta.get("og:site_name")).toBe("x");
  });
});

describe("cleaning", () => {
  it("decodes entities and strips tags/control characters", () => {
    expect(decodeEntities("A &amp; B &#39;C&#x27; &trade;")).toBe("A & B 'C' ™");
    expect(cleanText("  <b>Bold</b>\n\tname\u0007  ", 50)).toBe("Bold name");
    expect(cleanText("&amp;lt;tag&amp;gt;", 50)).toBe("tag");
    expect(cleanText("   ", 10)).toBeUndefined();
    expect(cleanText({ toString: () => "x" }, 10)).toBeUndefined();
    expect(cleanText("x".repeat(400), 300)).toHaveLength(300);
  });

  it("accepts only plain, sane prices", () => {
    expect(normalizePrice("249.99")).toBe("249.99");
    expect(normalizePrice("$1,249.5")).toBe("1249.50");
    expect(normalizePrice(19)).toBe("19.00");
    expect(normalizePrice(19.999)).toBe("20.00");
    for (const bad of ["-5", "1e9", "abc", "12.345", "", null, undefined, Number.NaN, "10000000.01", "99,99"]) expect(normalizePrice(bad)).toBeNull();
  });

  it("turns link slugs into suggested titles", () => {
    expect(titleFromSlug("shure-sm58-cardioid-dynamic-vocal-microphone")).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(titleFromSlug("Shure_SM58_Cardioid.html", /_+/)).toBe("Shure SM58 Cardioid");
    expect(titleFromSlug("ab")).toBeUndefined();
    expect(titleFromSlug(undefined)).toBeUndefined();
  });
});
