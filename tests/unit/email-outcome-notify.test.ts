/**
 * lib/notify requester emails report what actually happened: "sent" only when
 * the provider accepted the email; skipped (not configured), failed, opted out
 * or an internal error all resolve to "not_sent". Exactly one send per call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendResult } from "@/lib/email/send";

vi.mock("server-only", () => ({}));
const sendEmail = vi.fn<(...a: unknown[]) => Promise<SendResult>>();
vi.mock("@/lib/email/send", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/env", () => ({ publicEnv: () => ({ appUrl: "https://app.example.invalid" }) }));
vi.mock("@/lib/server-env", () => ({ serverEnv: () => ({ receiptsInboundAddress: "" }) }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => null, toE164: () => null }));

const inserted: Record<string, unknown>[] = [];
let prefs: { email_opt_in: boolean; sms_opt_in: boolean; phone: null; manage_token: string } | null = null;
let loadFails = false;
const REQ = {
  id: "11111111-1111-4111-8111-111111111111", requisition_number: "TKT-REQ-2026-0001", status: "submitted", requester_name: "Jamie Carter",
  requester_email: "jamie.carter@demo.invalid", requester_phone: "+1 312 555 0123", submitted_at: "2026-10-08T02:28:00Z", needed_by: "2026-10-22",
  estimated_total: "39.98", approved_total: "39.98", actual_total: "0", review_comment: null, reply_token: "r".repeat(32),
  departments: { name: "Production Team" }, department_subcategories: { name: "Audio Production" }, request_types: { name: "Order", workflow: "order" },
  requisition_items: [{ line_number: 1, description: "Windscreens", quantity: "2", estimated_total: "39.98", review_status: "approved", approved_quantity: "2", approved_total: "39.98", review_comment: null, priority: "medium", essential_justification: null }],
};
const SETTINGS = { church_name: "The Kings Tribe (TRAINING)", currency_code: "USD", timezone: "America/New_York", requisition_policy: "Policy.", po_instructions: "Instructions.", finance_notification_email: "finance@demo.invalid", email: "training@demo.invalid", phone: "2145550100", address_line1: "1234 Training Way", address_line2: null, city: "Dallas", region: "TX", postal_code: "75001", country: "USA" };
function table(name: string) {
  const chain: Record<string, unknown> = {};
  const result = () => {
    if (name === "requisitions") return loadFails ? Promise.reject(new Error("db down")) : Promise.resolve({ data: { ...REQ, notification_preferences: prefs } });
    if (name === "church_settings") return Promise.resolve({ data: SETTINGS });
    return Promise.resolve({ data: null });
  };
  for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
  chain.single = result;
  chain.insert = (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve({ error: null }); };
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({ isAdminClientConfigured: () => true, createSupabaseAdminClient: () => ({ from: table }) }));

const { notifyRequesterOfSubmission, notifyPurchaseOrderIssued } = await import("@/lib/notify");
const PO = { id: "22222222-2222-4222-8222-222222222222", po_number: "TKT-PO-2026-0001", total: "39.98", reply_token: "p".repeat(32), items: [{ description: "Windscreens", quantity: "2", line_total: "39.98" }] };

beforeEach(() => { sendEmail.mockReset(); inserted.length = 0; prefs = null; loadFails = false; });

describe.each([
  ["requester confirmation", () => notifyRequesterOfSubmission(REQ.id)],
  ["Purchase Order email", () => notifyPurchaseOrderIssued(REQ.id, PO, null)],
])("%s", (_label, send) => {
  it.each([
    [{ status: "sent", id: "provider-id" } as SendResult, "sent"],
    [{ status: "skipped", reason: "Email is not configured" } as SendResult, "not_sent"],
    [{ status: "failed", error: "HTTP 500" } as SendResult, "not_sent"],
  ])("provider result %o → %s, sent exactly once and logged", async (result, expected) => {
    sendEmail.mockResolvedValue(result);
    await expect(send()).resolves.toBe(expected);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(inserted.filter((r) => r.channel === "email")).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ status: result.status });
  });

  it("requester opted out → not_sent, nothing sent", async () => {
    prefs = { email_opt_in: false, sms_opt_in: false, phone: null, manage_token: "m".repeat(32) };
    await expect(send()).resolves.toBe("not_sent");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an internal error never throws and is reported as not_sent", async () => {
    loadFails = true;
    await expect(send()).resolves.toBe("not_sent");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a thrown provider error is not_sent (never a false claim)", async () => {
    sendEmail.mockRejectedValue(new Error("network"));
    await expect(send()).resolves.toBe("not_sent");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
