/**
 * "Get details" in the amendment form (getAmendmentProductDetails): staff
 * only, rate limited per user and per vendor domain, the same server-side
 * lookup as the request form (lib/product/lookup-service), and no token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
const lookupProduct = vi.fn();
vi.mock("@/lib/product/lookup", () => ({ lookupProduct: (...args: unknown[]) => lookupProduct(...args) }));
let permissions = new Set(["requisitions.view", "requisitions.amend"]);
const assertPermission = vi.fn(async (p: string) => {
  if (!permissions.has(p)) throw Object.assign(new Error("You do not have permission to do that."), { name: "ActionError" });
  return { id: "11111111-1111-4111-8111-111111111111", permissions };
});
vi.mock("@/lib/auth", () => ({ assertPermission: (p: string) => assertPermission(p) }));
vi.mock("@/lib/action-result", async (orig) => {
  const real = await orig<typeof import("@/lib/action-result")>();
  return { ...real, toActionError: (e: unknown) => ({ ok: false, error: (e as Error).message }) };
});

const { getAmendmentProductDetails } = await import("@/app/(app)/requisitions/[id]/product-actions");

const REQ = "00000000-0000-4000-8000-0000000000aa";
const URL_OK = "https://www.guitarcenter.com/Fender/Strat-1500000390193.gc";
const result = {
  outcome: "full", domain: "guitarcenter.com", method: "structured_data", priceNote: null, price: "849.99", currency: "USD",
  fields: { title: "Fender Strat", sku: "1500000390193", vendor_name: "Guitar Center" },
  diagnostics: { vendor: "guitarcenter", network: "ok", stage: "done", status: 200, ms: 120 },
};
let buckets: string[] = [];

beforeEach(() => {
  permissions = new Set(["requisitions.view", "requisitions.amend"]);
  lookupProduct.mockReset();
  lookupProduct.mockImplementation(async (_url: string, opts: { beforeNetwork: (d: string) => Promise<boolean> }) => {
    await opts.beforeNetwork("guitarcenter.com");
    return { ok: true, result };
  });
  buckets = [];
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: { p_bucket: string }) => {
    if (name === "consume_rate_limit") { buckets.push(args.p_bucket); return { data: true, error: null }; }
    return { data: null, error: null };
  });
});

describe("getAmendmentProductDetails", () => {
  it("returns the same cleaned fields as the request form, with no token", async () => {
    const r = await getAmendmentProductDetails(REQ, URL_OK);
    expect(r).toEqual({ ok: true, data: {
      outcome: "full", domain: "guitarcenter.com", method: "structured_data", fields: result.fields, price: "849.99", currency: "USD", priceNote: null, token: null,
    } });
    expect(lookupProduct).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ beforeNetwork: expect.any(Function) }));
  });

  it("is rate limited per user and per vendor domain", async () => {
    await getAmendmentProductDetails(REQ, URL_OK);
    expect(buckets).toEqual(["product:user:11111111-1111-4111-8111-111111111111", "product:domain:guitarcenter.com"]);
    rpc.mockImplementation(async () => ({ data: false, error: null }));
    expect(await getAmendmentProductDetails(REQ, URL_OK)).toEqual({ ok: false, error: "Too many lookups right now. Please complete the details below." });
  });

  it.each([["requisitions.amend"], ["requisitions.view"]])("requires %s", async (missing) => {
    permissions.delete(missing);
    const r = await getAmendmentProductDetails(REQ, URL_OK);
    expect(r).toMatchObject({ ok: false, error: "You do not have permission to do that." });
    expect(lookupProduct).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.guitarcenter.com/item",                // not https
    "https://user:pass@www.guitarcenter.com/item",     // credentials
    "https://www.guitarcenter.com:8443/item",          // non-standard port
    "https://127.0.0.1/item",                           // loopback
    "https://169.254.169.254/latest/meta-data",         // cloud metadata
    "https://10.0.0.5/internal",                        // private network
    "not a url",
  ])("rejects %s before any network access (same URL checks as the request form)", async (bad) => {
    const r = await getAmendmentProductDetails(REQ, bad);
    expect(r).toEqual({ ok: false, error: "Enter a full web address starting with https://" });
    expect(lookupProduct).not.toHaveBeenCalled();
    expect(buckets).toEqual([]);
  });

  it("rejects a malformed requisition id", async () => {
    expect(await getAmendmentProductDetails("nope", URL_OK)).toEqual({ ok: false, error: "Requisition not found." });
    expect(lookupProduct).not.toHaveBeenCalled();
  });

  it("a crashing lookup still returns a domain-only result (manual entry continues)", async () => {
    lookupProduct.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await getAmendmentProductDetails(REQ, URL_OK)).toEqual({ ok: true, data: {
      outcome: "domain", domain: "guitarcenter.com", method: null, fields: {}, price: null, currency: null, priceNote: null, token: null,
    } });
  });
});
