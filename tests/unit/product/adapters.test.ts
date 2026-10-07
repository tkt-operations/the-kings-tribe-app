/** Vendor URL-hint adapters: link patterns only, no network. */
import { describe, expect, it } from "vitest";
import { ADAPTERS, findAdapter } from "@/lib/product/adapters";

const hints = (url: string) => findAdapter(new URL(url).hostname).hints(new URL(url));

describe("vendor identification", () => {
  it.each([
    ["www.sweetwater.com", "sweetwater", false],
    ["www.amazon.com", "amazon", false],
    ["smile.amazon.com", "amazon", false],
    ["amzn.to", "amazon-short", false],
    ["a.co", "amazon-short", false],
    ["www.bhphotovideo.com", "bh-photo", false],
    ["www.guitarcenter.com", "guitar-center", false],
    ["www.bestbuy.com", "best-buy", false],
    ["www.walmart.com", "walmart", true],
    ["www.officedepot.com", "generic", true],
    ["notsweetwater.com", "generic", true],
    ["sweetwater.com.evil.example", "generic", true],
  ])("%s → %s (fetch page: %s)", (host, id, fetchPage) => {
    const adapter = findAdapter(host);
    expect(adapter.id).toBe(id);
    expect(adapter.fetchPage).toBe(fetchPage);
  });

  it("never fetches pages from vendors known to block automated retrieval", () => {
    for (const id of ["sweetwater", "amazon", "amazon-short", "bh-photo", "guitar-center", "best-buy"]) {
      expect(ADAPTERS.find((a) => a.id === id)?.fetchPage).toBe(false);
    }
  });
});

describe("URL hints", () => {
  it("Sweetwater: item ID and suggested title", () => {
    expect(hints("https://www.sweetwater.com/store/detail/SM58--shure-sm58-cardioid-dynamic-vocal-microphone")).toEqual({
      title: "Shure SM58 Cardioid Dynamic Vocal Microphone",
      sku: "SM58",
    });
    expect(hints("https://www.sweetwater.com/store/detail/BLX288PG58")).toEqual({ sku: "BLX288PG58" });
    expect(hints("https://www.sweetwater.com/c590--Microphones")).toEqual({});
  });

  it("Amazon: ASIN from every common link shape", () => {
    expect(hints("https://www.amazon.com/Shure-SM58-Cardioid-Microphone/dp/B000CZ0R42/ref=sr_1_1?th=1")).toEqual({ title: "Shure SM58 Cardioid Microphone", sku: "B000CZ0R42" });
    expect(hints("https://www.amazon.com/dp/b000cz0r42")).toEqual({ sku: "B000CZ0R42" });
    expect(hints("https://www.amazon.com/gp/product/B000CZ0R42?psc=1")).toEqual({ sku: "B000CZ0R42" });
    expect(hints("https://www.amazon.com/gp/aw/d/B000CZ0R42")).toEqual({ sku: "B000CZ0R42" });
    expect(hints("https://www.amazon.com/s?k=microphone")).toEqual({});
    expect(hints("https://www.amazon.com/dp/B000CZ0R4")).toEqual({}); // 9 chars
  });

  it("B&H: B&H number and title", () => {
    expect(hints("https://www.bhphotovideo.com/c/product/127212-REG/Shure_SM58_LC_SM58_Vocal_Microphone.html")).toEqual({
      title: "Shure SM58 LC SM58 Vocal Microphone",
      sku: "127212-REG",
    });
    expect(hints("https://www.bhphotovideo.com/c/buy/microphones/ci/1234")).toEqual({});
  });

  it("Guitar Center: brand and title", () => {
    expect(hints("https://www.guitarcenter.com/Shure/SM58-Mic.gc")).toEqual({ title: "SM58 Mic", brand: "Shure" });
    expect(hints("https://www.guitarcenter.com/Used/SM58-Mic.gc")).toEqual({ title: "SM58 Mic" });
    expect(hints("https://www.guitarcenter.com/Microphones/")).toEqual({});
  });

  it("Best Buy: SKU and title", () => {
    expect(hints("https://www.bestbuy.com/site/sony-wh-1000xm5-headphones/6505727.p?skuId=6505727")).toEqual({ title: "Sony Wh 1000XM5 Headphones", sku: "6505727" });
    expect(hints("https://www.bestbuy.com/site/searchpage.jsp?skuId=6505727")).toEqual({ sku: "6505727" });
  });

  it("Walmart: item ID and title", () => {
    expect(hints("https://www.walmart.com/ip/Mainstays-Folding-Table/123456789")).toEqual({ title: "Mainstays Folding Table", sku: "123456789" });
  });

  it("generic sites give no hints", () => {
    expect(hints("https://www.officedepot.com/a/products/123/")).toEqual({});
  });
});
