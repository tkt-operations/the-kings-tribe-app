/** Lookup orchestration: vendor → safe fetch (if allowed) → JSON-LD → Open Graph → URL hints. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { lookupProduct } = await import("@/lib/product/lookup");
type SafeFetchResult = import("@/lib/product/safe-fetch").SafeFetchResult;

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const page = (body: string, url = "https://www.example.com/"): SafeFetchResult => ({ ok: true, finalUrl: new URL(url), status: 200, body, truncated: false });
const fetchReturning = (result: SafeFetchResult) => vi.fn(async () => result);

async function run(url: string, fetch: ReturnType<typeof vi.fn>, beforeNetwork?: (d: string) => Promise<boolean>) {
  const r = await lookupProduct(url, { fetch: fetch as never, beforeNetwork });
  if (!r.ok) throw new Error(r.reason);
  return r.result;
}

describe("lookupProduct", () => {
  it("full information from structured data", async () => {
    const fetch = fetchReturning(page(fixture("full-jsonld.html")));
    const r = await run("https://www.officesupplies.example/a/products/5791037/Chair/", fetch);
    expect(r).toMatchObject({
      outcome: "full", method: "structured_data", domain: "officesupplies.example", price: "249.99", currency: "USD",
      fields: { title: "Ergonomic Mesh Task Chair & Headrest", brand: "Realspace", model: "BX-200", sku: "5791037", vendor_name: "Office Supplies Co" },
    });
    expect(fetch).toHaveBeenCalledWith("https://www.officesupplies.example/a/products/5791037/Chair/", expect.objectContaining({ mode: "page" }));
  });

  it("Open Graph fallback", async () => {
    const r = await run("https://shop.example.com/table", fetchReturning(page(fixture("og-only.html"))));
    expect(r).toMatchObject({ outcome: "full", method: "open_graph", price: "59.00", fields: { title: "Folding Table, 6 ft – White", vendor_name: "Example Store" } });
  });

  it("partial information (no reliable price)", async () => {
    const r = await run("https://shop.example.com/mic", fetchReturning(page(fixture("multiple-offers.html"))));
    expect(r).toMatchObject({ outcome: "partial", method: "structured_data", price: null, priceNote: "multiple", fields: { title: "Wireless Microphone" } });
  });

  it.each([
    ["no metadata", page(fixture("no-metadata.html"))],
    ["blocked (403)", { ok: false, reason: "http_error", status: 403 } as SafeFetchResult],
    ["timeout", { ok: false, reason: "timeout" } as SafeFetchResult],
    ["private address", { ok: false, reason: "blocked_address" } as SafeFetchResult],
  ])("nothing but the domain: %s", async (_label, result) => {
    const r = await run("https://www.smallshop.example/item/9", fetchReturning(result));
    expect(r).toMatchObject({ outcome: "domain", method: null, domain: "smallshop.example", fields: {}, price: null });
  });

  it("never throws when the fetcher does", async () => {
    const r = await run("https://shop.example.com/x", vi.fn(async () => { throw new Error("boom"); }));
    expect(r.outcome).toBe("domain");
  });

  it("URL hints only for vendors that block retrieval — their pages are never requested", async () => {
    const fetch = vi.fn();
    const r = await run("https://www.sweetwater.com/store/detail/SM58--shure-sm58-cardioid-dynamic-vocal-microphone", fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ outcome: "hints", method: "url_hint", domain: "sweetwater.com", price: null, fields: { sku: "SM58", vendor_name: "Sweetwater", title: "Shure SM58 Cardioid Dynamic Vocal Microphone" } });
  });

  it("a known vendor with an unrecognised link still identifies the vendor", async () => {
    const r = await run("https://www.bhphotovideo.com/find/newarrivals.jsp", vi.fn());
    expect(r).toMatchObject({ outcome: "hints", method: "url_hint", fields: { vendor_name: "B&H Photo" } });
  });

  it("a fetchable vendor that blocks falls back to its URL hints", async () => {
    const r = await run("https://www.walmart.com/ip/Mainstays-Folding-Table/123456789", fetchReturning({ ok: false, reason: "http_error", status: 403 }));
    expect(r).toMatchObject({ outcome: "hints", method: "url_hint", fields: { sku: "123456789", title: "Mainstays Folding Table", vendor_name: "Walmart" } });
  });

  it("Amazon short links: redirects only, then the ASIN hint (no page body)", async () => {
    const fetch = vi.fn(async () => ({ ok: true, finalUrl: new URL("https://www.amazon.com/dp/B000CZ0R42?tag=x"), status: 200, body: "", truncated: false }) as SafeFetchResult);
    const r = await run("https://amzn.to/3abcXYZ", fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://amzn.to/3abcXYZ", expect.objectContaining({ mode: "redirects" }));
    expect(r).toMatchObject({ outcome: "hints", method: "url_hint", domain: "amazon.com", fields: { sku: "B000CZ0R42", vendor_name: "Amazon" } });
  });

  it("an unresolvable short link still names the vendor", async () => {
    const r = await run("https://amzn.to/3abcXYZ", fetchReturning({ ok: false, reason: "timeout" }));
    expect(r).toMatchObject({ outcome: "hints", domain: "amzn.to", fields: { vendor_name: "Amazon" } });
  });

  it("skips the network when the per-domain limit is reached", async () => {
    const fetch = vi.fn();
    const r = await run("https://shop.example.com/x", fetch, async () => false);
    expect(fetch).not.toHaveBeenCalled();
    expect(r.outcome).toBe("domain");
  });

  it("rejects unsafe links before doing anything", async () => {
    const fetch = vi.fn();
    expect(await lookupProduct("http://shop.example.com/", { fetch })).toEqual({ ok: false, reason: "invalid_url" });
    expect(await lookupProduct("https://169.254.169.254/latest", { fetch })).toEqual({ ok: false, reason: "invalid_url" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("V1.1 vendor strategy", () => {
  it.each([
    ["Sweetwater", "https://www.sweetwater.com/store/detail/SM58--shure-sm58-cardioid-dynamic-vocal-microphone", { sku: "SM58" }],
    ["B&H Photo", "https://www.bhphotovideo.com/c/product/127212-REG/Shure_SM58_LC_SM58_Vocal_Microphone.html", { sku: "127212-REG" }],
    ["Best Buy", "https://www.bestbuy.com/site/shure-dynamic-cardioid-vocal-microphone/7535385.p?skuId=7535385", { sku: "7535385" }],
    ["Amazon", "https://www.amazon.com/dp/B000CZ0R42", { sku: "B000CZ0R42" }],
    ["Guitar Center", "https://www.guitarcenter.com/Shure/SM58-Dynamic-Handheld-Vocal-Microphone-1274034494045.gc", { sku: "1274034494045", brand: "Shure", title: "SM58 Dynamic Handheld Vocal Microphone" }],
    ["Office Depot", "https://www.officedepot.com/a/products/273646/Office-Depot-Brand-Copier-Paper-Letter/", { sku: "273646", title: "Office Depot Brand Copier Paper Letter" }],
    ["Staples", "https://www.staples.com/tru-red-copy-paper-8-1-2-x-11-case/product_135848", { sku: "135848" }],
    ["Home Depot", "https://www.homedepot.com/p/Lifetime-6-ft-Black-Resin-Fold-in-Half-Folding-Table-80867/312208040", { sku: "312208040" }],
    ["Adorama", "https://www.adorama.com/shsm58lc.html", { sku: "shsm58lc" }],
    ["Monoprice", "https://www.monoprice.com/product?p_id=42674", { sku: "42674" }],
  ])("%s: link hints only, zero network requests, never a price", async (vendor, url, expected) => {
    const fetch = vi.fn();
    const beforeNetwork = vi.fn(async () => true);
    const r = await run(url, fetch, beforeNetwork);
    expect(fetch).not.toHaveBeenCalled();
    expect(beforeNetwork).not.toHaveBeenCalled(); // not even a rate-limit slot is used
    expect(r).toMatchObject({ outcome: "hints", method: "url_hint", price: null, currency: null, fields: { ...expected, vendor_name: vendor } });
    expect(r.diagnostics).toEqual({ vendor: expect.any(String), network: "none", stage: null, status: null, ms: null });
  });

  it("a known blocking vendor with an unrecognised link still makes no request", async () => {
    const fetch = vi.fn();
    const r = await run("https://www.officedepot.com/b/copy-and-multipurpose-paper/N-530730", fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ outcome: "hints", fields: { vendor_name: "Office Depot" } });
  });

  it("strips the retailer suffix from retrieved titles (Walmart product.item page)", async () => {
    const r = await run("https://www.walmart.com/ip/Lifetime-6-Foot-Rectangle-Folding-Table/189144292", fetchReturning(page(fixture("walmart-og-product.html"))));
    expect(r).toMatchObject({
      outcome: "partial", method: "open_graph", price: null,
      fields: { title: "Lifetime 6 Foot Rectangle Folding Table Indoor/Outdoor Commercial Grade, White Granite (80306)", sku: "189144292", vendor_name: "Walmart" },
    });
  });

  it("a generic Open Graph page is not product information: domain only, no title, no vendor from og:site_name", async () => {
    const html = fixture("generic-og-not-product.html").replace("</head>", '<meta property="og:site_name" content="Shure"></head>');
    const r = await run("https://www.shure.example/en-US/products/microphones/sm58", fetchReturning(page(html)));
    expect(r).toMatchObject({ outcome: "domain", method: null, fields: {} });
  });

  it("a ProductGroup without offers: title and brand, the site's name as vendor, no price", async () => {
    const r = await run("https://rode.example/en-us/products/wirelessgoii", fetchReturning(page(fixture("productgroup-no-offers.html"))));
    expect(r).toMatchObject({ outcome: "partial", method: "structured_data", price: null, fields: { title: "Wireless GO II", brand: "RØDE", vendor_name: "RØDE Microphones" } });
  });

  it("records diagnostics for failed and rate-limited fetches", async () => {
    const blocked = await run("https://shop.example.com/x", fetchReturning({ ok: false, reason: "http_error", status: 403 }));
    expect(blocked.diagnostics).toMatchObject({ vendor: "generic", network: "http_error", stage: "page", status: 403 });
    expect(blocked.diagnostics.ms).toEqual(expect.any(Number));
    const timedOut = await run("https://shop.example.com/x", fetchReturning({ ok: false, reason: "timeout" }));
    expect(timedOut.diagnostics).toMatchObject({ network: "timeout", status: null });
    const limited = await run("https://shop.example.com/x", vi.fn(), async () => false);
    expect(limited.diagnostics).toMatchObject({ network: "rate_limited", stage: null });
    const ok = await run("https://shop.example.com/x", fetchReturning(page(fixture("og-only.html"))));
    expect(ok.diagnostics).toMatchObject({ network: "ok", stage: "page", status: 200 });
    // Diagnostics never carry the link itself.
    expect(JSON.stringify([blocked, timedOut, limited, ok].map((r) => r.diagnostics))).not.toMatch(/shop\.example|https?:|\/x/);
  });
});
