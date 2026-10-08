/**
 * Success messages reflect the real email outcome. The submission and the
 * Purchase Order succeed regardless; only the wording about email changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.SUPABASE_SECRET_KEY = "test-secret-key-for-hmac";
const FORM_TOKEN = "t".repeat(48);
const REQ_ID = "11111111-1111-4111-8111-111111111111";
const PO_ID = "22222222-2222-4222-8222-222222222222";

const adminRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: adminRpc }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Vitest" }) }));
const after = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertPermission: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/data/purchase-order-pdf", () => ({ buildPurchaseOrderPdf: async () => ({ pdf: Buffer.from("%PDF"), poNumber: "TKT-PO-2026-0001", requisitionId: REQ_ID }) }));
const serverRpc = vi.fn(async (fn: string) => ({
  data: fn === "issue_purchase_order" ? { id: PO_ID, po_number: "TKT-PO-2026-0001", total: "39.98", previous_status: "approved", status: "po_issued" } : null, error: null,
}));
const storageUpload = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: serverRpc,
    storage: { from: () => ({ upload: storageUpload }) },
    from: () => { const c: Record<string, unknown> = {}; c.select = () => c; c.eq = () => c; c.single = async () => ({ data: { reply_token: "p".repeat(32), purchase_order_items: [{ description: "Windscreens", quantity: "2", line_total: "39.98", line_number: 1 }] } }); return c; },
  }),
}));
const notifyRequesterOfSubmission = vi.fn();
const notifyFinanceOfSubmission = vi.fn();
const notifyPurchaseOrderIssued = vi.fn();
vi.mock("@/lib/notify", () => ({
  notifyRequesterOfSubmission: (...a: unknown[]) => notifyRequesterOfSubmission(...a),
  notifyFinanceOfSubmission: (...a: unknown[]) => notifyFinanceOfSubmission(...a),
  notifyPurchaseOrderIssued: (...a: unknown[]) => notifyPurchaseOrderIssued(...a),
  notifyReceiptReceived: vi.fn(), notifyStatusChange: vi.fn(),
}));
const { previewFormContext } = await import("@/app/dev-preview/fixtures");
vi.mock("@/lib/data/form-context", async () => ({ FORM_TOKEN_PATTERN: /^[A-Za-z0-9_-]{32,128}$/, loadFormContext: async () => previewFormContext }));

const { submitExternalRequisition } = await import("@/app/request/[token]/actions");
const { issuePurchaseOrder } = await import("@/app/(app)/requisitions/[id]/actions");
const { issueFormStamp } = await import("@/lib/spam");
const { EMPTY_LINE_ITEM } = await import("@/lib/validation/requisition");

beforeEach(() => {
  vi.clearAllMocks();
  adminRpc.mockResolvedValue({ data: { id: REQ_ID, requisition_number: "TKT-REQ-2026-0042", submitted_at: "2026-10-08T03:30:00Z", needed_by: "2026-10-22", department_name: "Production Team", subcategory_name: "Audio Production", request_type_name: "Order", estimated_total: "39.98", status: "submitted", items: [] }, error: null });
});

describe("external requisition submission", () => {
  const ctx = previewFormContext;
  const input = {
    requester_name: "Jamie Carter", requester_email: "jamie.carter@demo.invalid", requester_phone: "+1 312 555 0123", department_head_name: "Jamie Carter",
    department_id: ctx.departments[1].id, subcategory_id: ctx.departments[1].subcategories[0].id, request_type_id: ctx.request_types[0].id, cost_center_id: "",
    needed_by: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), budget_status: "yes", budget_explanation: "", justification: "Replace worn windscreens before Sunday services.",
    actual_purchase_amount: "", purchase_vendor: "", purchase_date: "", certification_accepted: true, certification_name: "Jamie Carter", sms_opt_in: false,
    items: [{ ...EMPTY_LINE_ITEM, description: "Windscreens", quantity: "2", estimated_unit_price: "19.99" }],
  };
  const submit = () => submitExternalRequisition(FORM_TOKEN, input, [], issueFormStamp(Date.now() - 10_000), "");

  it.each([["sent", true], ["not_sent", false]] as const)("requester email %s → confirmation_emailed %s; submission succeeds either way", async (outcome, emailed) => {
    notifyRequesterOfSubmission.mockResolvedValue(outcome);
    const r = await submit();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ requisition_number: "TKT-REQ-2026-0042", confirmation_emailed: emailed });
    expect(notifyRequesterOfSubmission).toHaveBeenCalledTimes(1);
    expect(notifyRequesterOfSubmission).toHaveBeenCalledWith(REQ_ID);
    // Finance is still told after the response, exactly once.
    expect(after).toHaveBeenCalledTimes(1);
    expect(notifyFinanceOfSubmission).not.toHaveBeenCalled();
    after.mock.calls[0][0]();
    expect(notifyFinanceOfSubmission).toHaveBeenCalledTimes(1);
  });

  it("no email attempt when the submission itself fails", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "This link has reached its submission limit." } });
    const r = await submit();
    expect(r).toEqual({ ok: false, error: "This link has reached its submission limit." });
    expect(notifyRequesterOfSubmission).not.toHaveBeenCalled();
  });
});

describe("issue Purchase Order", () => {
  const issue = () => issuePurchaseOrder(REQ_ID, { vendor: { name: "Training Supply Co." }, notes: "", items: [{ requisition_item_id: "33333333-3333-4333-8333-333333333333", quantity: "2" }] } as never);

  it("email accepted → says emailed", async () => {
    notifyPurchaseOrderIssued.mockResolvedValue("sent");
    const r = await issue();
    expect(r).toMatchObject({ ok: true, data: { poNumber: "TKT-PO-2026-0001", emailed: true } });
    expect(r.ok && r.message).toBe("Purchase order TKT-PO-2026-0001 created successfully. It was emailed to the requester.");
    expect(notifyPurchaseOrderIssued).toHaveBeenCalledTimes(1);
  });

  it.each(["skipped / not configured", "failed"])("email %s → PO still created, no emailed claim, one attempt", async () => {
    notifyPurchaseOrderIssued.mockResolvedValue("not_sent");
    const r = await issue();
    expect(r).toMatchObject({ ok: true, data: { poNumber: "TKT-PO-2026-0001", emailed: false } });
    const message = r.ok ? r.message ?? "" : "";
    expect(message).toBe("Purchase order TKT-PO-2026-0001 created successfully. It was not emailed to the requester — download the PDF and share it with them.");
    expect(message).not.toMatch(/created successfully and emailed|It was emailed/);
    expect(serverRpc.mock.calls.filter((c) => c[0] === "issue_purchase_order")).toHaveLength(1);
    expect(notifyPurchaseOrderIssued).toHaveBeenCalledTimes(1);
  });

  it("PDF warning and email outcome are both reported truthfully", async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: "storage down" } } as never);
    notifyPurchaseOrderIssued.mockResolvedValue("not_sent");
    const r = await issue();
    expect(r.ok && r.message).toMatch(/^Purchase order TKT-PO-2026-0001 created\. The Purchase Order was issued but its PDF could not be stored\. .* It was not emailed to the requester/);
    expect(notifyPurchaseOrderIssued.mock.calls[0][2]).toBeNull(); // no PDF attached
  });
});
