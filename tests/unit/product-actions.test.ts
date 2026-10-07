/**
 * Server actions: "Get details" (rate limits, signed tokens, never throws) and
 * the submission's per-line lookup classification. Invalid / tampered tokens
 * never keep attribution, and the requester gets the same response either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.SUPABASE_SECRET_KEY = "test-secret-key-for-hmac";

const FORM_TOKEN = "t".repeat(48);
const FORM_ID = "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Vitest" }) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyRequisitionSubmitted: vi.fn() }));
const lookupProduct = vi.fn();
vi.mock("@/lib/product/lookup", () => ({ lookupProduct: (...args: unknown[]) => lookupProduct(...args) }));
const { previewFormContext } = await import("@/app/dev-preview/fixtures");
vi.mock("@/lib/data/form-context", async () => ({
  FORM_TOKEN_PATTERN: /^[A-Za-z0-9_-]{32,128}$/,
  loadFormContext: async () => previewFormContext,
}));

const { getProductDetails } = await import("@/app/request/[token]/product-actions");
const { submitExternalRequisition } = await import("@/app/request/[token]/actions");
const { signLookupToken } = await import("@/lib/product/lookup-token");
const { issueFormStamp } = await import("@/lib/spam");
const { EMPTY_LINE_ITEM } = await import("@/lib/validation/requisition");

const URL_A = "https://www.officedepot.com/a/products/5791037/Chair/";
const LOOKUP = {
  outcome: "full", domain: "officedepot.com", method: "structured_data", normalizedUrl: URL_A,
  fields: { title: "Mesh Chair", brand: "Realspace", sku: "5791037" }, price: "249.99", currency: "USD", priceNote: null,
};

let rateLimit: Record<string, boolean>;
let submitted: Record<string, unknown> | null;

beforeEach(() => {
  rateLimit = {};
  submitted = null;
  lookupProduct.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "resolve_form_token_id") return { data: FORM_ID, error: null };
    if (name === "consume_rate_limit") {
      const bucket = String(args.p_bucket);
      const prefix = bucket.split(":").slice(0, 2).join(":");
      return { data: rateLimit[prefix] ?? true, error: null };
    }
    if (name === "submit_requisition_with_product") {
      submitted = args;
      return {
        data: {
          id: "req-1", requisition_number: "TKT-REQ-2026-0002", submitted_at: "2026-10-05T12:00:00Z", needed_by: "2026-10-20",
          department_name: "Hospitality Team", subcategory_name: "Guest Experience", request_type_name: "Order",
          estimated_total: "249.99", status: "submitted", items: [],
        },
        error: null,
      };
    }
    return { data: null, error: { code: "XX", message: `unexpected rpc ${name}` } };
  });
});

describe("getProductDetails", () => {
  it("returns cleaned details and a token signed for this form link and URL", async () => {
    lookupProduct.mockResolvedValue({ ok: true, result: LOOKUP });
    const r = await getProductDetails(FORM_TOKEN, URL_A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ outcome: "full", domain: "officedepot.com", method: "structured_data", price: "249.99", fields: LOOKUP.fields });
    const claims = JSON.parse(Buffer.from(r.data.token!.split(".")[1], "base64url").toString("utf8"));
    expect(claims).toMatchObject({ fid: FORM_ID, url: URL_A, dom: "officedepot.com", m: "structured_data", p: "249.99", c: "USD" });
    // Rate limits: per link, per client, and (passed to the lookup) per domain.
    const buckets = rpc.mock.calls.filter((c) => c[0] === "consume_rate_limit").map((c) => [String(c[1].p_bucket).split(":").slice(0, 2).join(":"), c[1].p_max, c[1].p_window_seconds]);
    expect(buckets).toEqual([["product:token", 30, 3600], ["product:fp", 20, 3600]]);
    const deps = lookupProduct.mock.calls[0][1];
    await deps.beforeNetwork("officedepot.com");
    expect(rpc).toHaveBeenLastCalledWith("consume_rate_limit", { p_bucket: "product:domain:officedepot.com", p_max: 60, p_window_seconds: 3600 });
  });

  it("issues no token when nothing beyond the domain was found", async () => {
    lookupProduct.mockResolvedValue({ ok: true, result: { ...LOOKUP, outcome: "domain", method: null, fields: {}, price: null, currency: null } });
    const r = await getProductDetails(FORM_TOKEN, URL_A);
    expect(r.ok && r.data.token).toBeNull();
  });

  it.each(["product:token", "product:fp"])("rate limited (%s) — no lookup is made", async (bucket) => {
    rateLimit[bucket] = false;
    const r = await getProductDetails(FORM_TOKEN, URL_A);
    expect(r).toEqual({ ok: false, error: "Too many lookups right now. Please complete the details below." });
    expect(lookupProduct).not.toHaveBeenCalled();
  });

  it("rejects unsafe links and invalid form links before any lookup", async () => {
    expect(await getProductDetails(FORM_TOKEN, "http://example.com/")).toMatchObject({ ok: false });
    expect(await getProductDetails(FORM_TOKEN, "https://127.0.0.1/")).toMatchObject({ ok: false });
    expect(await getProductDetails("bad", URL_A)).toMatchObject({ ok: false, error: "This requisition link is invalid." });
    rpc.mockImplementationOnce(async () => ({ data: null, error: null }));
    expect(await getProductDetails(FORM_TOKEN, URL_A)).toMatchObject({ ok: false, error: "This requisition link is invalid or has expired." });
    expect(lookupProduct).not.toHaveBeenCalled();
  });

  it("never throws: an unexpected failure becomes a domain-only result", async () => {
    lookupProduct.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await getProductDetails(FORM_TOKEN, URL_A);
    expect(r).toEqual({ ok: true, data: { outcome: "domain", domain: "officedepot.com", method: null, fields: {}, price: null, currency: null, priceNote: null, token: null } });
    warn.mockRestore();
  });
});

describe("submitExternalRequisition — product lookup classification", () => {
  const ctx = previewFormContext;
  const base = (items: Record<string, unknown>[]) => ({
    requester_name: "Jordan Example", requester_email: "jordan@example.org", requester_phone: "(555) 010-2000",
    department_head_name: "Jordan Example", department_id: ctx.departments[1].id, subcategory_id: ctx.departments[1].subcategories[0].id,
    request_type_id: ctx.request_types[0].id, cost_center_id: "", needed_by: "2026-10-20", budget_status: "yes", budget_explanation: "",
    justification: "Chairs for the guest welcome area on Sunday mornings.", actual_purchase_amount: "", purchase_vendor: "", purchase_date: "",
    certification_accepted: true, certification_name: "Jordan Example", sms_opt_in: false,
    items: items.map((i) => ({ ...EMPTY_LINE_ITEM, description: "Mesh Chair", quantity: "2", estimated_unit_price: "249.99", ...i })),
  });
  const stamp = () => issueFormStamp(Date.now() - 10_000);
  const token = (over: Record<string, unknown> = {}) =>
    signLookupToken({ fid: FORM_ID, url: URL_A, dom: "officedepot.com", m: "structured_data", at: Date.now(), f: { title: "Mesh Chair", brand: "Realspace", sku: "5791037" }, p: "249.99", c: "USD", ...over });
  const tamper = (t: string) => {
    const [v, body, mac] = t.split(".");
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    json.p = "1.00";
    return `${v}.${Buffer.from(JSON.stringify(json)).toString("base64url")}.${mac}`;
  };
  const lines = () => ((submitted!.p_payload as { items: Record<string, unknown>[] }).items);

  it("normal manual entry: no token → status none, typed values, no attribution", async () => {
    const r = await submitExternalRequisition(FORM_TOKEN, base([{ requested_brand: "Realspace" }]), [], stamp(), "");
    expect(r.ok).toBe(true);
    expect(lines()[0]).toMatchObject({ description: "Mesh Chair", requested_brand: "Realspace", requested_model: null, lookup: { status: "none" } });
    expect(lines()[0]).not.toHaveProperty("product_lookup");
    // No lookup token at all: the form link is not even resolved for classification.
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["submit_requisition_with_product"]);
  });

  it("verified: attribution and server-computed edited fields", async () => {
    await submitExternalRequisition(FORM_TOKEN, base([{ vendor_url: URL_A, product_lookup: token(), requested_brand: "Realspace", requested_sku: "5791037", estimated_unit_price: "229.00" }]), [], stamp(), "");
    expect(lines()[0].lookup).toMatchObject({ status: "verified", method: "structured_data", domain: "officedepot.com", price: "249.99", currency: "USD", edited_fields: ["estimated_unit_price"] });
  });

  it("expired, changed-URL and tampered tokens keep typed values but never attribution", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await submitExternalRequisition(FORM_TOKEN, base([
      { vendor_url: URL_A, product_lookup: token({ at: Date.now() - 25 * 3600 * 1000 }) },
      { vendor_url: "https://www.officedepot.com/a/products/999/Desk/", product_lookup: token() },
      { vendor_url: URL_A, product_lookup: tamper(token()) },
      { vendor_url: URL_A, product_lookup: token({ fid: "7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d" }) },
      { vendor_url: URL_A, product_lookup: "garbage" },
    ]), [], stamp(), "");
    expect(lines().map((l) => l.lookup)).toEqual([
      { status: "expired" },
      { status: "url_changed" },
      { status: "rejected", reason: "signature" },
      { status: "rejected", reason: "wrong_link" },
      { status: "rejected", reason: "malformed" },
    ]);
    for (const l of lines()) expect(l.description).toBe("Mesh Chair");
    expect(warn).toHaveBeenCalledWith("product lookup token rejected", expect.objectContaining({ lines: [{ line: 3, reason: "signature" }, { line: 4, reason: "wrong_link" }, { line: 5, reason: "malformed" }] }));
    warn.mockRestore();
  });

  it("a tampered token gets exactly the same response as no token (no security detail revealed)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clean = await submitExternalRequisition(FORM_TOKEN, base([{ vendor_url: URL_A }]), [], stamp(), "");
    const tampered = await submitExternalRequisition(FORM_TOKEN, base([{ vendor_url: URL_A, product_lookup: tamper(token()) }]), [], stamp(), "");
    expect(tampered).toEqual(clean);
    expect(tampered.ok).toBe(true);
    // An oversized token never blocks submission either.
    const huge = await submitExternalRequisition(FORM_TOKEN, base([{ vendor_url: URL_A, product_lookup: "x".repeat(10_000) }]), [], stamp(), "");
    expect(huge).toEqual(clean);
    warn.mockRestore();
  });
});
