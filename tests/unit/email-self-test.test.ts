/**
 * TEMPORARY administrator email delivery self-test: authentication,
 * administrator authorization, self-recipient only, fixed content, one Resend
 * call through the normal sender, the normal notifications log row, repeat
 * protection, and that nothing else is written. Resend is mocked (no email is sent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));
vi.mock("@/lib/server-env", () => ({
  serverEnv: () => ({ resendApiKey: "re_test_only", emailFrom: "Kings Tribe <ops@example.org>", receiptsInboundAddress: "", resendDeliveryWebhookSecret: "" }),
}));
const sms = vi.fn();
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => ({ send: sms }), toE164: () => null }));

// --- fake Supabase clients that record every call ---
interface Call { client: "user" | "admin"; op: string; args: unknown[] }
let calls: Call[];
let rateLimitAllowed: Record<string, boolean>;
let insertError: unknown;
let latestRow: Record<string, unknown> | null;
function chain(client: "user" | "admin", table: string) {
  const q: Record<string, unknown> = {};
  for (const op of ["select", "eq", "order", "limit", "update", "delete", "upsert"]) {
    q[op] = (...args: unknown[]) => { calls.push({ client, op: `${table}.${op}`, args }); return q; };
  }
  q.insert = (...args: unknown[]) => { calls.push({ client, op: `${table}.insert`, args }); return Promise.resolve({ error: insertError }); };
  q.single = async () => ({ data: { church_name: "The Kings Tribe", currency_code: "USD", timezone: "America/Chicago" }, error: null });
  q.maybeSingle = async () => ({ data: latestRow, error: null });
  return q;
}
const client = (kind: "user" | "admin") => ({
  from: (t: string) => { calls.push({ client: kind, op: `from:${t}`, args: [] }); return chain(kind, t); },
  rpc: vi.fn(async (n: string, args: { p_bucket?: string }) => {
    calls.push({ client: kind, op: `rpc:${n}`, args: [args] });
    return n === "consume_rate_limit" ? { data: rateLimitAllowed[(args.p_bucket ?? "").split(":")[1]] ?? true, error: null } : { data: null, error: null };
  }),
});
const userClient = client("user");
const adminClient = client("admin");
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => adminClient, isAdminClientConfigured: () => true }));

const fetchMock = vi.fn();
const { sendTestEmailToMyself, getTestEmailStatus } = await import("@/app/(app)/admin/settings/email-test-actions");
const { DELIVERY_SELF_TEST } = await import("@/lib/notify");

const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "Admin.Self@Example.org", fullName: "Admin", roles: ["administrator"], permissions: new Set() };
const ops = () => calls.map((c) => `${c.client}:${c.op}`);
const resendCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://api.resend.com/"));
const sentBody = () => JSON.parse(resendCalls()[0][1].body as string) as { to: string[]; subject: string; html: string; text: string; from: string };

beforeEach(() => {
  calls = [];
  rateLimitAllowed = {};
  insertError = null;
  latestRow = null;
  sms.mockReset();
  getSessionUser.mockReset().mockResolvedValue(ADMIN);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("authorization", () => {
  it.each([
    ["signed out", null],
    ["deactivated (getSessionUser returns null for inactive profiles)", null],
    ["signed in without the administrator role", { ...ADMIN, roles: ["finance"] }],
    ["a viewer", { ...ADMIN, roles: ["viewer"] }],
  ])("%s is denied before anything is sent or written", async (_label, user) => {
    getSessionUser.mockResolvedValue(user);
    const result = await sendTestEmailToMyself();
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]); // not even the rate limit is consumed
    expect((await getTestEmailStatus()).ok).toBe(false);
  });
});

describe("sending", () => {
  it("sends exactly one fixed email to the administrator's own address through the normal Resend sender", async () => {
    const result = await sendTestEmailToMyself();
    expect(result).toEqual({ ok: true, data: undefined, message: "Test email accepted for delivery. Check your inbox." });
    expect(resendCalls()).toHaveLength(1);
    const [url, init] = resendCalls()[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_only");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(new RegExp(`^delivery-self-test-${ADMIN.id}-\\d+$`));
    const body = sentBody();
    expect(body.to).toEqual(["admin.self@example.org"]);
    expect(body.subject).toBe("The Kings Tribe — Email Delivery Test");
    expect(body.text).toContain("This is a controlled email delivery test for The Kings Tribe Operations notification system. No action is required.");
    expect(body.html).toContain("This is a controlled email delivery test");
    expect(body.text).not.toMatch(/requisition #|TKT-|\$\d|Approved amount|Purchase Order/i);
    expect(sms).not.toHaveBeenCalled();
  });

  it("ignores anything the caller tries to pass (no recipient, subject, body or ids are accepted)", async () => {
    expect(sendTestEmailToMyself.length).toBe(0);
    const forged = { to: "victim@example.com", subject: "x", body: "y", provider_message_id: "z", notification_id: "n", requisition_id: "r" };
    await (sendTestEmailToMyself as unknown as (i: unknown) => Promise<unknown>)(forged);
    expect(sentBody().to).toEqual(["admin.self@example.org"]);
    expect(sentBody().subject).toBe(DELIVERY_SELF_TEST.subject);
    const row = calls.find((c) => c.op === "notifications.insert")!.args[0] as Record<string, unknown>;
    expect(row).toMatchObject({ recipient: "admin.self@example.org", requisition_id: null, provider_message_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
  });

  it("writes one normal notifications row with the real provider message id, and touches nothing else", async () => {
    await sendTestEmailToMyself();
    const inserts = calls.filter((c) => c.op.endsWith(".insert"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual({
      requisition_id: null, channel: "email", template: "delivery_self_test", recipient: "admin.self@example.org",
      subject: "The Kings Tribe — Email Delivery Test", status: "sent", provider_message_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", error: null,
    });
    // Only: rate limit, church settings (email footer), the log row. No requisition, status history,
    // user_notifications, push, receipts, POs, vendor orders, audit or delivery-event writes.
    expect(new Set(ops())).toEqual(new Set([
      "admin:rpc:consume_rate_limit", "admin:from:church_settings", "admin:church_settings.select", "admin:church_settings.eq",
      "admin:from:notifications", "admin:notifications.insert",
    ]));
    for (const forbidden of ["requisitions", "status_history", "user_notifications", "push_", "receipts", "purchase_orders", "vendor_orders", "audit", "notification_events", "record_email_delivery_event"]) {
      expect(ops().some((o) => o.includes(forbidden))).toBe(false);
    }
  });

  it("rapid repeats are blocked by the server rate limit (one per 10 minutes, three per day)", async () => {
    const buckets = () => calls.filter((c) => c.op === "rpc:consume_rate_limit").map((c) => c.args[0]);
    await sendTestEmailToMyself();
    expect(buckets()).toEqual([
      { p_bucket: `email-self-test:10min:${ADMIN.id}`, p_max: 1, p_window_seconds: 600 },
      { p_bucket: `email-self-test:day:${ADMIN.id}`, p_max: 3, p_window_seconds: 86_400 },
    ]);
    for (const blocked of ["10min", "day"]) {
      calls = [];
      fetchMock.mockClear();
      rateLimitAllowed = { [blocked]: false };
      const result = await sendTestEmailToMyself();
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("recently") });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(ops().some((o) => o.includes("insert"))).toBe(false);
    }
  });

  it("a Resend rejection is logged as failed, reported generically, and never retried", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "Internal detail from provider" }), { status: 422 }));
    const result = await sendTestEmailToMyself();
    expect(result).toEqual({ ok: false, error: "Resend did not accept the test email." });
    expect(resendCalls()).toHaveLength(1);
    expect(calls.find((c) => c.op === "notifications.insert")!.args[0]).toMatchObject({ status: "failed", provider_message_id: null });
  });

  it("a failed log write is reported (the success message only follows a recorded send)", async () => {
    insertError = { message: "db down" };
    expect(await sendTestEmailToMyself()).toEqual({ ok: false, error: "The test email was sent but could not be recorded." });
    expect(resendCalls()).toHaveLength(1);
  });

  it("success and error messages never reveal the recipient, keys or provider id", async () => {
    const ok = await sendTestEmailToMyself();
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    rateLimitAllowed = {};
    const bad = await sendTestEmailToMyself();
    for (const text of [JSON.stringify(ok), JSON.stringify(bad)]) {
      expect(text).not.toMatch(/admin\.self|re_test_only|4ef9a417|whsec_/i);
    }
  });
});

describe("delivery status readout", () => {
  it("reads the caller's own latest test with row-level security and returns labels only", async () => {
    latestRow = {
      channel: "email", status: "sent", created_at: "2026-10-07T23:00:00Z", delivery_status: "delivered", delivery_status_at: "2026-10-07T23:00:04Z",
      notification_events: [{ event_type: "delivered", occurred_at: "2026-10-07T23:00:04Z" }, { event_type: "sent", occurred_at: "2026-10-07T23:00:01Z" }],
    };
    const result = await getTestEmailStatus();
    expect(result).toEqual({ ok: true, data: {
      sentAt: "2026-10-07T23:00:00Z", app: "Accepted by Resend", provider: "Delivered", tone: "positive", providerAt: "2026-10-07T23:00:04Z",
      events: [{ type: "sent", at: "2026-10-07T23:00:01Z" }, { type: "delivered", at: "2026-10-07T23:00:04Z" }],
    } });
    expect(ops()).toContain("user:from:notifications");
    expect(ops().some((o) => o.startsWith("admin:"))).toBe(false);
    const filters = calls.filter((c) => c.op === "notifications.eq").map((c) => c.args);
    expect(filters).toEqual([["template", "delivery_self_test"], ["recipient", "admin.self@example.org"]]);
    expect(JSON.stringify(result)).not.toMatch(/admin\.self|recipient|provider_message_id/);
  });

  it("an accepted test without webhook events shows no delivery claim", async () => {
    latestRow = { channel: "email", status: "sent", created_at: "2026-10-07T23:00:00Z", delivery_status: null, delivery_status_at: null, notification_events: [] };
    expect(await getTestEmailStatus()).toMatchObject({ ok: true, data: { app: "Accepted by Resend", provider: null, events: [] } });
  });
});
