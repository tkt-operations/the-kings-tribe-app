/** Signed lookup tokens: classification at submission and server-side edit detection. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.SUPABASE_SECRET_KEY = "test-secret-key-for-hmac";
const { classifyLookup, editedFields, lookupPayload, signLookupToken } = await import("@/lib/product/lookup-token");

const FORM_ID = "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER_FORM_ID = "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const URL_A = "https://www.officedepot.com/a/products/5791037/Chair/";
const NOW = 1_800_000_000_000;

const claims = (over: Record<string, unknown> = {}) => ({
  fid: FORM_ID, url: URL_A, dom: "officedepot.com", m: "structured_data" as const, at: NOW,
  f: { title: "Mesh Chair", brand: "Realspace", model: "BX-200", sku: "5791037", vendor_name: "Office Depot", color: "Black" },
  p: "249.99", c: "USD", ...over,
});

const ctx = (over: Record<string, unknown> = {}) => ({ formTokenId: FORM_ID, vendorUrl: URL_A, now: NOW + 60_000, ...over });

function tamper(token: string, edit: (c: Record<string, unknown>) => void): string {
  const [v, body, mac] = token.split(".");
  const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  edit(json);
  return `${v}.${Buffer.from(JSON.stringify(json)).toString("base64url")}.${mac}`;
}

beforeEach(() => {
  process.env.SUPABASE_SECRET_KEY = "test-secret-key-for-hmac";
});

describe("classifyLookup", () => {
  it("no token → none (normal manual entry)", () => {
    expect(classifyLookup(undefined, ctx())).toEqual({ status: "none" });
    expect(classifyLookup("", ctx())).toEqual({ status: "none" });
    expect(classifyLookup(null, ctx())).toEqual({ status: "none" });
  });

  it("a genuine, current token for this link → verified", () => {
    const r = classifyLookup(signLookupToken(claims()), ctx());
    expect(r.status).toBe("verified");
    if (r.status === "verified") expect(r.claims).toMatchObject({ fid: FORM_ID, url: URL_A, p: "249.99" });
  });

  it("tolerates harmless differences in how the same link is written", () => {
    expect(classifyLookup(signLookupToken(claims()), ctx({ vendorUrl: `  ${URL_A.replace("www.officedepot.com", "WWW.OfficeDepot.com")}#reviews ` })).status).toBe("verified");
  });

  it("expired after 24 hours", () => {
    expect(classifyLookup(signLookupToken(claims()), ctx({ now: NOW + 24 * 3600 * 1000 + 1 }))).toEqual({ status: "expired" });
  });

  it("URL changed or removed after the lookup", () => {
    const token = signLookupToken(claims());
    expect(classifyLookup(token, ctx({ vendorUrl: "https://www.officedepot.com/a/products/999/Desk/" }))).toEqual({ status: "url_changed" });
    expect(classifyLookup(token, ctx({ vendorUrl: "" }))).toEqual({ status: "url_changed" });
    expect(classifyLookup(token, ctx({ vendorUrl: null }))).toEqual({ status: "url_changed" });
  });

  it("checks rejection first: a changed-URL AND tampered token is rejected", () => {
    const token = tamper(signLookupToken(claims()), (c) => { c.p = "1.00"; });
    expect(classifyLookup(token, ctx({ vendorUrl: "https://other.example.com/" }))).toEqual({ status: "rejected", reason: "signature" });
  });

  it.each([
    ["changed price", (c: Record<string, unknown>) => { c.p = "1.00"; }],
    ["changed title", (c: Record<string, unknown>) => { (c.f as Record<string, unknown>).title = "Something else"; }],
    ["changed method", (c: Record<string, unknown>) => { c.m = "url_hint"; }],
    ["extended expiry", (c: Record<string, unknown>) => { c.at = NOW + 10 ** 9; }],
    ["moved to another link", (c: Record<string, unknown>) => { c.url = "https://evil.example.com/"; }],
  ])("tampered payload (%s) → rejected: signature", (_label, edit) => {
    expect(classifyLookup(tamper(signLookupToken(claims()), edit), ctx())).toEqual({ status: "rejected", reason: "signature" });
  });

  it("changed signature → rejected: signature", () => {
    const token = signLookupToken(claims());
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(classifyLookup(flipped, ctx())).toEqual({ status: "rejected", reason: "signature" });
  });

  it("signed for a different form link → rejected: wrong_link", () => {
    expect(classifyLookup(signLookupToken(claims({ fid: OTHER_FORM_ID })), ctx())).toEqual({ status: "rejected", reason: "wrong_link" });
  });

  it.each([
    ["garbage", "garbage"],
    ["wrong version", "v2.abc.def"],
    ["missing parts", "v1.abc"],
    ["empty parts", "v1..sig"],
    ["too large", `v1.${"a".repeat(5000)}.sig`],
    ["not a string", 12345],
    ["an object", { token: "x" }],
  ])("malformed (%s) → rejected: malformed", (_label, token) => {
    expect(classifyLookup(token, ctx())).toEqual({ status: "rejected", reason: "malformed" });
  });

  it("a validly signed but schema-invalid payload → rejected: malformed", () => {
    expect(classifyLookup(signLookupToken(claims({ p: "12.3456" })), ctx())).toEqual({ status: "rejected", reason: "malformed" });
    expect(classifyLookup(signLookupToken(claims({ m: "url_hint" })), ctx())).toEqual({ status: "rejected", reason: "malformed" }); // url_hint never carries a price
    expect(classifyLookup(signLookupToken(claims({ extra: "field" })), ctx())).toEqual({ status: "rejected", reason: "malformed" });
  });

  it("a rotated server secret invalidates outstanding tokens (rejected, never trusted)", () => {
    const token = signLookupToken(claims());
    process.env.SUPABASE_SECRET_KEY = "rotated-secret";
    expect(classifyLookup(token, ctx())).toEqual({ status: "rejected", reason: "signature" });
  });

  it("the same lookup on two lines: verified where the link matches, url_changed where it does not", () => {
    const token = signLookupToken(claims());
    expect(classifyLookup(token, ctx()).status).toBe("verified");
    expect(classifyLookup(token, ctx({ vendorUrl: URL_A })).status).toBe("verified");
    expect(classifyLookup(token, ctx({ vendorUrl: "https://www.officedepot.com/other" })).status).toBe("url_changed");
  });
});

describe("edited fields and database payload", () => {
  const line = {
    description: "Mesh Chair", vendor_name: "Office Depot", estimated_unit_price: "249.99",
    requested_brand: "Realspace", requested_model: "BX-200", requested_sku: "5791037", color: "Black", size: null,
  };

  it("nothing edited when the requester kept the fetched values", () => {
    expect(editedFields(claims() as never, line)).toEqual([]);
    expect(editedFields(claims() as never, { ...line, estimated_unit_price: "249.990".slice(0, 6) })).toEqual([]);
  });

  it("detects every changed fetched field on the server", () => {
    expect(editedFields(claims() as never, { ...line, description: "Mesh Chair (black)", estimated_unit_price: "199", requested_sku: null, color: "Grey" }))
      .toEqual(["description", "requested_sku", "color", "estimated_unit_price"]);
  });

  it("verified payload carries attribution; other statuses carry none", () => {
    const verified = classifyLookup(signLookupToken(claims()), ctx());
    expect(lookupPayload(verified, { ...line, estimated_unit_price: "229.00" })).toEqual({
      status: "verified", method: "structured_data", domain: "officedepot.com", fetched_at: new Date(NOW).toISOString(),
      price: "249.99", currency: "USD",
      values: { title: "Mesh Chair", brand: "Realspace", model: "BX-200", sku: "5791037", vendor_name: "Office Depot", color: "Black" },
      edited_fields: ["estimated_unit_price"],
    });
    expect(lookupPayload({ status: "none" }, line)).toEqual({ status: "none" });
    expect(lookupPayload({ status: "expired" }, line)).toEqual({ status: "expired" });
    expect(lookupPayload({ status: "url_changed" }, line)).toEqual({ status: "url_changed" });
    expect(lookupPayload({ status: "rejected", reason: "signature" }, line)).toEqual({ status: "rejected", reason: "signature" });
  });
});
