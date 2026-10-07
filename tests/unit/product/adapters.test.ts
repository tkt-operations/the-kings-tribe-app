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
    ["www.officedepot.com", "office-depot", false],
    ["www.staples.com", "staples", false],
    ["www.homedepot.com", "home-depot", false],
    ["www.adorama.com", "adorama", false],
    ["www.monoprice.com", "monoprice", false],
    ["shop.example.com", "generic", true],
    ["notsweetwater.com", "generic", true],
    ["sweetwater.com.evil.example", "generic", true],
  ])("%s → %s (fetch page: %s)", (host, id, fetchPage) => {
    const adapter = findAdapter(host);
    expect(adapter.id).toBe(id);
    expect(adapter.fetchPage).toBe(fetchPage);
  });

  it("never fetches pages from vendors known to block automated retrieval", () => {
    for (const id of ["sweetwater", "amazon", "amazon-short", "bh-photo", "guitar-center", "best-buy", "office-depot", "staples", "home-depot", "adorama", "monoprice"]) {
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
    expect(hints("https://www.guitarcenter.com/Shure/SM58-Mic.gc")).toEqual({ title: "SM58 Mic", brand: "Shure" }); // no item number
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

  it("Office Depot: item number and title from /a/products/{item}/{slug}/", () => {
    expect(hints("https://www.officedepot.com/a/products/273646/Office-Depot-Brand-Copier-Paper-Letter/")).toEqual({ title: "Office Depot Brand Copier Paper Letter", sku: "273646" });
    expect(hints("https://www.officedepot.com/a/products/870284/")).toEqual({ sku: "870284" });
    expect(hints("https://www.officedepot.com/b/copy-and-multipurpose-paper/N-530730")).toEqual({});
    expect(hints("https://www.officedepot.com/a/products/abc/Chair/")).toEqual({});
  });

  it("Staples: item number and title from /{slug}/product_{item}", () => {
    expect(hints("https://www.staples.com/staples-select-copy-paper-8-5-x-11-20-lbs-white-500-sheets-ream-10-reams-carton-20472/product_897802")).toMatchObject({ sku: "897802" });
    expect(hints("https://www.staples.com/tru-red-copy-paper-8-1-2-x-11-case/product_135848?akamai-feo=off")).toEqual({ title: "Tru Red Copy Paper 8 1 2 X 11 Case", sku: "135848" });
    expect(hints("https://www.staples.com/product_SS2758846")).toEqual({ sku: "SS2758846" });
    expect(hints("https://www.staples.com/Copy-Paper/cat_CL140420")).toEqual({});
  });

  it("Home Depot: Internet number and title from /p/{slug}/{number}", () => {
    expect(hints("https://www.homedepot.com/p/Lifetime-6-ft-Black-Resin-Fold-in-Half-Folding-Table-80867/312208040")).toEqual({
      title: "Lifetime 6 Ft Black Resin Fold In Half Folding Table 80867",
      sku: "312208040",
    });
    expect(hints("https://www.homedepot.com/p/312208040")).toEqual({ sku: "312208040" });
    expect(hints("https://www.homedepot.com/p/reviews/Lifetime-6-ft-Table-280857/324972590/3")).toEqual({});
    expect(hints("https://www.homedepot.com/p/questions/Lifetime-Table/323713925")).toEqual({});
    expect(hints("https://www.homedepot.com/b/Furniture/N-5yc1vZc7pc")).toEqual({});
  });

  it("Adorama: item code only (the link has no title)", () => {
    expect(hints("https://www.adorama.com/shsm58lc.html")).toEqual({ sku: "shsm58lc" });
    expect(hints("https://www.adorama.com/alc/shure-sm58-special-edition-black/")).toEqual({});
    expect(hints("https://www.adorama.com/l/Pro-Audio/Microphones")).toEqual({});
  });

  it("Monoprice: product number only (the link has no title)", () => {
    expect(hints("https://www.monoprice.com/product?p_id=42674")).toEqual({ sku: "42674" });
    expect(hints("https://www.monoprice.com/Product?p_id=2698")).toEqual({ sku: "2698" });
    expect(hints("https://www.monoprice.com/product?p_id=abc")).toEqual({});
    expect(hints("https://www.monoprice.com/category/cables")).toEqual({});
  });

  it("Guitar Center: the trailing item number becomes the SKU and leaves the title", () => {
    expect(hints("https://www.guitarcenter.com/Shure/SM58-Dynamic-Handheld-Vocal-Microphone-1274034494045.gc")).toEqual({
      title: "SM58 Dynamic Handheld Vocal Microphone",
      brand: "Shure",
      sku: "1274034494045",
    });
    expect(hints("https://www.guitarcenter.com/Shure/BLX288-SM58-Wireless-Dual-Vocal-System-with-two-SM58-Handheld-Transmitters-Band-H9-1500000302258.gc")).toMatchObject({ sku: "1500000302258", brand: "Shure" });
    // Short numbers are part of the name, not an item number.
    expect(hints("https://www.guitarcenter.com/Shure/SM58-Mic-25.gc")).toEqual({ title: "SM58 Mic 25", brand: "Shure" });
  });

  it("never invents a price from a link", () => {
    for (const adapter of ADAPTERS) {
      const sample = new URL(`https://www.${adapter.domains[0]}/a/products/123456/x/`);
      expect(Object.keys(adapter.hints(sample))).not.toContain("price");
    }
  });

  it("generic sites give no hints", () => {
    expect(hints("https://shop.example.com/a/products/123/")).toEqual({});
  });
});
