/**
 * SSRF-safe fetcher: address checks on every hop, pinned connections,
 * redirect limits, timeouts, size limits (after decompression) and
 * content-type checks. Uses a fake transport — never the network.
 */
import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { safeFetch, pinnedLookup, USER_AGENT } = await import("@/lib/product/safe-fetch");
type Transport = import("@/lib/product/safe-fetch").Transport;
type TransportResponse = import("@/lib/product/safe-fetch").TransportResponse;

const HTML = "text/html; charset=utf-8";

async function* chunks(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === "string" ? new TextEncoder().encode(p) : p;
}

function response(status: number, headers: Record<string, string> = {}, body: AsyncIterable<Uint8Array> = chunks("")): TransportResponse {
  return { status, headers, body, destroy: vi.fn() };
}

function resolverFor(map: Record<string, string[]>) {
  return vi.fn(async (host: string) => (map[host] ?? []).map((address) => ({ address, family: (address.includes(":") ? 6 : 4) as 4 | 6 })));
}

const PUBLIC = { "shop.example.com": ["93.184.216.34"], "cdn.example.net": ["2606:4700::6810:84e5"] };

describe("safeFetch — addresses", () => {
  it("connects to the validated address with a fixed user agent and no cookies", async () => {
    const transport = vi.fn<Transport>(async () => response(200, { "content-type": HTML }, chunks("<html>ok</html>")));
    const r = await safeFetch("https://shop.example.com/p/1", { resolver: resolverFor(PUBLIC), transport });
    expect(r).toMatchObject({ ok: true, body: "<html>ok</html>", truncated: false });
    const call = transport.mock.calls[0][0];
    expect(call.address).toEqual({ address: "93.184.216.34", family: 4 });
    expect(call.url.href).toBe("https://shop.example.com/p/1");
    expect(call.headers["user-agent"]).toBe(USER_AGENT);
    expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toContain("cookie");
  });

  it.each([
    ["127.0.0.1"], ["10.1.2.3"], ["169.254.169.254"], ["192.168.0.10"], ["100.64.1.1"], ["0.0.0.0"], ["::1"], ["fd00::1"], ["::ffff:127.0.0.1"], ["fe80::1"],
  ])("refuses a hostname that resolves to %s (transport never called)", async (address) => {
    const transport = vi.fn<Transport>();
    const r = await safeFetch("https://evil.example.com/", { resolver: resolverFor({ "evil.example.com": [address] }), transport });
    expect(r).toEqual({ ok: false, reason: "blocked_address" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses when ANY resolved address is private (mixed public/private answers)", async () => {
    const transport = vi.fn<Transport>();
    const r = await safeFetch("https://mixed.example.com/", { resolver: resolverFor({ "mixed.example.com": ["93.184.216.34", "10.0.0.1"] }), transport });
    expect(r).toEqual({ ok: false, reason: "blocked_address" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("reports DNS failures and empty answers", async () => {
    const failing = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    expect(await safeFetch("https://nowhere.example.com/", { resolver: failing, transport: vi.fn<Transport>() })).toEqual({ ok: false, reason: "dns" });
    expect(await safeFetch("https://nowhere.example.com/", { resolver: resolverFor({}), transport: vi.fn<Transport>() })).toEqual({ ok: false, reason: "dns" });
  });

  it("rejects unsafe URLs before any DNS lookup", async () => {
    const resolver = resolverFor(PUBLIC);
    for (const url of ["http://shop.example.com/", "https://127.0.0.1/", "https://localhost/", "https://u:p@shop.example.com/", "https://shop.example.com:8080/", "file:///etc/passwd"]) {
      expect(await safeFetch(url, { resolver, transport: vi.fn<Transport>() })).toEqual({ ok: false, reason: "invalid_url" });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("defeats DNS rebinding: the connection uses the address that was checked", async () => {
    // First answer is public; a later (rebound) answer would be private. We resolve once per hop and pin it.
    let calls = 0;
    const resolver = vi.fn(async () => (calls++ === 0 ? [{ address: "93.184.216.34", family: 4 as const }] : [{ address: "127.0.0.1", family: 4 as const }]));
    const transport = vi.fn<Transport>(async () => response(200, { "content-type": HTML }, chunks("ok")));
    await safeFetch("https://rebind.example.com/", { resolver, transport });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].address.address).toBe("93.184.216.34");
  });

  it("pinnedLookup always answers with the pinned address, whatever hostname is asked", () => {
    const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 }) as unknown as (h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => void;
    const single = vi.fn();
    lookup("attacker-controlled.example", {}, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("anything", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("safeFetch — redirects", () => {
  const hosts = { ...PUBLIC, "a.example.com": ["93.184.216.1"], "b.example.com": ["93.184.216.2"], "c.example.com": ["93.184.216.3"], "d.example.com": ["93.184.216.4"], "inside.example.com": ["10.0.0.7"] };

  it("follows a valid redirect (relative and absolute) and re-validates each hop", async () => {
    const resolver = resolverFor(hosts);
    const transport = vi.fn<Transport>(async ({ url }) => {
      if (url.hostname === "a.example.com") return response(301, { location: "https://b.example.com/x" });
      if (url.pathname === "/x") return response(302, { location: "/final?id=2" });
      return response(200, { "content-type": HTML }, chunks("final"));
    });
    const r = await safeFetch("https://a.example.com/", { resolver, transport });
    expect(r.ok && r.finalUrl.href).toBe("https://b.example.com/final?id=2");
    expect(resolver.mock.calls.map((c) => c[0])).toEqual(["a.example.com", "b.example.com", "b.example.com"]);
  });

  it("allows at most 3 redirects", async () => {
    const order = ["a", "b", "c", "d", "a"];
    const transport = vi.fn<Transport>(async ({ url }) => {
      const next = order[order.indexOf(url.hostname[0]) + 1];
      return response(302, { location: `https://${next}.example.com/` });
    });
    const r = await safeFetch("https://a.example.com/", { resolver: resolverFor(hosts), transport });
    expect(r).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["http://b.example.com/", "invalid_url"],
    ["https://127.0.0.1/admin", "invalid_url"],
    ["https://[::1]/", "invalid_url"],
    ["https://localhost/", "invalid_url"],
    ["https://inside.example.com/", "blocked_address"],
  ])("refuses a redirect to %s", async (location, reason) => {
    const transport = vi.fn<Transport>(async () => response(302, { location }));
    const r = await safeFetch("https://a.example.com/", { resolver: resolverFor(hosts), transport });
    expect(r).toEqual({ ok: false, reason });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("redirects mode returns the final URL without reading any body", async () => {
    const body = { [Symbol.asyncIterator]: () => { throw new Error("body must not be read"); } } as AsyncIterable<Uint8Array>;
    const transport = vi.fn<Transport>(async ({ url }) =>
      url.hostname === "a.example.com" ? response(301, { location: "https://b.example.com/dp/B000CZ0R42" }) : response(200, { "content-type": HTML }, body));
    const r = await safeFetch("https://a.example.com/s", { mode: "redirects", resolver: resolverFor(hosts), transport });
    expect(r.ok && r.finalUrl.href).toBe("https://b.example.com/dp/B000CZ0R42");
  });
});

describe("safeFetch — responses", () => {
  const resolver = resolverFor(PUBLIC);

  it.each([403, 404, 429, 500, 503])("reports HTTP %s (blocked / unavailable)", async (status) => {
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => response(status, { "content-type": HTML }) });
    expect(r).toEqual({ ok: false, reason: "http_error", status });
  });

  it.each(["application/json", "image/png", "text/plain", "application/octet-stream", ""])("refuses content type %j", async (type) => {
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => response(200, type ? { "content-type": type } : {}, chunks("{}")) });
    expect(r).toEqual({ ok: false, reason: "not_html" });
  });

  it("accepts application/xhtml+xml", async () => {
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => response(200, { "content-type": "application/xhtml+xml" }, chunks("<x/>")) });
    expect(r.ok).toBe(true);
  });

  it("times out when the server never answers", async () => {
    const r = await safeFetch("https://shop.example.com/", { resolver, timeoutMs: 50, transport: () => new Promise(() => {}) });
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });

  it("times out on a body that trickles forever", async () => {
    async function* slow() {
      yield new TextEncoder().encode("<html>");
      await new Promise(() => {});
    }
    const r = await safeFetch("https://shop.example.com/", { resolver, timeoutMs: 50, transport: async () => response(200, { "content-type": HTML }, slow()) });
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });

  it("times out on slow DNS", async () => {
    const r = await safeFetch("https://shop.example.com/", { resolver: () => new Promise(() => {}), timeoutMs: 50, transport: vi.fn<Transport>() });
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });

  it("stops reading at the size limit (and never pulls the rest of the stream)", async () => {
    let pulled = 0;
    async function* huge() {
      while (true) {
        pulled++;
        yield new Uint8Array(64 * 1024).fill(97);
      }
    }
    const r = await safeFetch("https://shop.example.com/", { resolver, maxBytes: 256 * 1024, transport: async () => response(200, { "content-type": HTML }, huge()) });
    expect(r.ok && r.body.length).toBe(256 * 1024);
    expect(r.ok && r.truncated).toBe(true);
    expect(pulled).toBeLessThanOrEqual(6);
  });

  it("limits size AFTER decompression (gzip bomb)", async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61)); // 20 MB → ~20 KB compressed
    expect(bomb.length).toBeLessThan(100 * 1024);
    const r = await safeFetch("https://shop.example.com/", {
      resolver,
      maxBytes: 512 * 1024,
      transport: async () => response(200, { "content-type": HTML, "content-encoding": "gzip" }, chunks(bomb)),
    });
    expect(r.ok && r.body.length).toBe(512 * 1024);
    expect(r.ok && r.truncated).toBe(true);
  });

  it("decodes brotli and deflate-free identity bodies", async () => {
    const br = brotliCompressSync(Buffer.from("<html>brotli</html>"));
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => response(200, { "content-type": HTML, "content-encoding": "br" }, chunks(br)) });
    expect(r.ok && r.body).toBe("<html>brotli</html>");
  });

  it("refuses unknown content encodings", async () => {
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => response(200, { "content-type": HTML, "content-encoding": "zstd-weird" }, chunks("x")) });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("honours a declared charset", async () => {
    const r = await safeFetch("https://shop.example.com/", {
      resolver,
      transport: async () => response(200, { "content-type": "text/html; charset=windows-1252" }, chunks(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))),
    });
    expect(r.ok && r.body).toBe("Café");
  });

  it("maps connection errors to a generic network failure", async () => {
    const r = await safeFetch("https://shop.example.com/", { resolver, transport: async () => { throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }); } });
    expect(r).toEqual({ ok: false, reason: "network" });
  });
});
