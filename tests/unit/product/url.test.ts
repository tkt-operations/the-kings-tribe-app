/** Product link checks shared by the form and the server (SSRF: the URL is untrusted). */
import { describe, expect, it } from "vitest";
import { canonicalProductUrl, checkProductUrl, displayDomain } from "@/lib/product/url";

const reason = (url: string) => {
  const r = checkProductUrl(url);
  return r.ok ? "ok" : r.reason;
};

describe("checkProductUrl", () => {
  it("accepts ordinary https product links and drops the fragment", () => {
    const r = checkProductUrl("  https://www.OfficeDepot.com/a/products/123/Chair/#reviews ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe("https://www.officedepot.com/a/products/123/Chair/");
      expect(r.host).toBe("www.officedepot.com");
    }
    expect(reason("https://shop.example.org:443/p?id=1")).toBe("ok");
  });

  it.each([
    ["http://example.com/p", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["ftp://example.com/x", "not_https"],
    ["gopher://example.com/x", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["data:text/html,hi", "not_https"],
    ["https://user:pass@example.com/", "credentials"],
    ["https://user@example.com/", "credentials"],
    ["https://example.com:8443/", "port"],
    ["https://example.com:80/", "port"],
    ["https://127.0.0.1/", "ip_address"],
    ["https://0.0.0.0/", "ip_address"],
    ["https://169.254.169.254/latest/meta-data/", "ip_address"],
    ["https://10.0.0.5/", "ip_address"],
    ["https://2130706433/", "ip_address"], // decimal 127.0.0.1
    ["https://0x7f000001/", "ip_address"], // hex
    ["https://0177.0.0.1/", "ip_address"], // octal
    ["https://127.1/", "ip_address"], // short form
    ["https://[::1]/", "ip_address"],
    ["https://[::ffff:127.0.0.1]/", "ip_address"],
    ["https://[fe80::1]/", "ip_address"],
    ["https://localhost/", "host"],
    ["https://intranet/", "host"],
    ["https://metadata.google.internal/", "host"],
    ["https://printer.local/", "host"],
    ["https://router.home.arpa/", "host"],
    ["https://app.localhost/", "host"],
    ["not a url", "invalid"],
    ["", "empty"],
    [`https://example.com/${"a".repeat(2100)}`, "too_long"],
  ])("rejects %s (%s)", (url, expected) => {
    expect(reason(url)).toBe(expected);
  });
});

describe("canonicalProductUrl / displayDomain", () => {
  it("binds lookups to the same canonical form the server checks", () => {
    expect(canonicalProductUrl(" https://Example.com./p?x=1#top ")).toBe("https://example.com/p?x=1");
    expect(canonicalProductUrl("https://example.com/p?x=1")).toBe(checkProductUrl("https://example.com/p?x=1#a").ok && "https://example.com/p?x=1");
    expect(canonicalProductUrl("")).toBeNull();
    expect(canonicalProductUrl("nope")).toBeNull();
  });
  it("shows the domain without www", () => {
    expect(displayDomain("WWW.OfficeDepot.com")).toBe("officedepot.com");
  });
});
