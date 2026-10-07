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
    const r = await run("https://www.officedepot.com/a/products/5791037/Chair/", fetch);
    expect(r).toMatchObject({
      outcome: "full", method: "structured_data", domain: "officedepot.com", price: "249.99", currency: "USD",
      fields: { title: "Ergonomic Mesh Task Chair & Headrest", brand: "Realspace", model: "BX-200", sku: "5791037", vendor_name: "Office Supplies Co" },
    });
    expect(fetch).toHaveBeenCalledWith("https://www.officedepot.com/a/products/5791037/Chair/", expect.objectContaining({ mode: "page" }));
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
