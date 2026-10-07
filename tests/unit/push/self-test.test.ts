/**
 * TEMPORARY administrator Web Push self-test: authentication, administrator
 * authorization, self-device-only sending, requisition validation, fixed
 * payload, repeat protection, and that nothing but subscription health is written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));
const notify = { notifyRequisitionSubmitted: vi.fn(), notifyStatusChange: vi.fn() };
vi.mock("@/lib/notify", () => notify);
const webpushSend = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...a: unknown[]) => webpushSend(...a) } }));

// --- fake Supabase clients that record every call ---
interface Call { client: "user" | "admin"; op: string; args: unknown[] }
let calls: Call[];
let visibleRequisitions: Set<string>;
let subscriptionsByUser: Record<string, { id: string; endpoint: string; p256dh: string; auth: string }[]>;
let rateLimitAllowed: boolean;
function chain(client: "user" | "admin", table: string) {
  const state: { filters: [string, unknown][] } = { filters: [] };
  const q: Record<string, unknown> = {};
  for (const op of ["select", "order", "limit", "insert", "update", "delete", "upsert"]) {
    q[op] = (...args: unknown[]) => { calls.push({ client, op: `${table}.${op}`, args }); return q; };
  }
  q.eq = (col: string, val: unknown) => { calls.push({ client, op: `${table}.eq`, args: [col, val] }); state.filters.push([col, val]); return q; };
  q.maybeSingle = async () => {
    const id = state.filters.find(([c]) => c === "id")?.[1] as string;
    return { data: table === "requisitions" && visibleRequisitions.has(id) ? { id } : null, error: null };
  };
  q.then = (resolve: (v: unknown) => void) => {
    if (table === "push_subscriptions") {
      const uid = state.filters.find(([c]) => c === "user_id")?.[1] as string;
      return resolve({ data: subscriptionsByUser[uid] ?? [], error: null });
    }
    return resolve({ data: [...visibleRequisitions].map((id) => ({ id, requisition_number: "TKT-REQ-2026-0002", submitted_at: "2026-10-07T20:03:43Z" })), error: null });
  };
  return q;
}
const userClient = { from: (t: string) => { calls.push({ client: "user", op: `from:${t}`, args: [] }); return chain("user", t); }, rpc: vi.fn(async (n: string) => { calls.push({ client: "user", op: `rpc:${n}`, args: [] }); return { data: null, error: null }; }) };
const adminClient = {
  from: (t: string) => { calls.push({ client: "admin", op: `from:${t}`, args: [] }); return chain("admin", t); },
  rpc: vi.fn(async (n: string, args: unknown) => { calls.push({ client: "admin", op: `rpc:${n}`, args: [args] }); return n === "consume_rate_limit" ? { data: rateLimitAllowed, error: null } : { data: null, error: null }; }),
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => adminClient }));

const ADMIN = { id: "11111111-1111-4111-8111-111111111111", roles: ["administrator"] };
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const HIDDEN_REQ = "3c3317dd-aca8-4427-9d9d-4171b14673e3";
const SUB = (id: string, endpoint = `https://web.push.apple.com/device-${id}`) => ({ id, endpoint, p256dh: "BPu7ShjHv_X1lC3h5i_vG0oR0Ksw0C9bJZzYk1b8ZtQe2sB9Yl3n5vGgK1w5kq7T3x2b0Rk8yWQn4T6m0gX1a2c", auth: "k7Yv2XsL3qN9pR1tUwZ0aQ" });
const PUBLIC = "BAbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjK";

const { sendTestPush, listTestPushTargets } = await import("@/app/(app)/notifications/push-test-actions");
const { runPushSelfTest } = await import("@/lib/push/self-test");

beforeEach(() => {
  calls = [];
  visibleRequisitions = new Set([REQ]);
  subscriptionsByUser = { [ADMIN.id]: [SUB("a1")], [OTHER]: [SUB("o1", "https://web.push.apple.com/other-user-device")] };
  rateLimitAllowed = true;
  getSessionUser.mockResolvedValue(ADMIN);
  webpushSend.mockReset();
  webpushSend.mockResolvedValue({ statusCode: 201 });
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = PUBLIC;
  process.env.VAPID_PRIVATE_KEY = "pR1vAtEkEyAbCdEfGhIjKlMnOpQrStUvWxYz0123456";
  process.env.VAPID_SUBJECT = "mailto:operations@thekingstribe.org";
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const writes = () => calls.filter((c) => /\.(insert|update|delete|upsert)$/.test(c.op));
const rpcs = () => calls.filter((c) => c.op.startsWith("rpc:")).map((c) => c.op);

describe("who may send", () => {
  it("1/3. denies signed-out and deactivated users (getSessionUser returns null for both)", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(await listTestPushTargets()).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(webpushSend).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("2. denies internal users who are not administrators (even with broad finance permissions)", async () => {
    for (const roles of [["head_of_finance"], ["finance_user"], ["reporting_user"], ["viewer"], []]) {
      getSessionUser.mockResolvedValue({ id: OTHER, roles });
      expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "Only administrators can send a test notification." });
      expect(await listTestPushTargets()).toMatchObject({ ok: false });
    }
    expect(webpushSend).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("what is sent, and to whom", () => {
  it("4/5. sends only to the caller's own devices (user id from the session); another user's device is never loaded", async () => {
    const r = await sendTestPush(REQ);
    expect(r).toEqual({ ok: true, data: { devices: 1, sent: 1 }, message: "Test notification sent to 1 device. Tap it on your phone." });
    expect(calls.filter((c) => c.op === "push_subscriptions.eq")).toEqual([{ client: "admin", op: "push_subscriptions.eq", args: ["user_id", ADMIN.id] }]);
    expect(webpushSend).toHaveBeenCalledTimes(1);
    expect((webpushSend.mock.calls[0][0] as { endpoint: string }).endpoint).toBe("https://web.push.apple.com/device-a1");
    expect(JSON.stringify(webpushSend.mock.calls)).not.toContain("other-user-device");
  });

  it("6/7/8. accepts only a requisition id: endpoints, user ids, URLs or objects are rejected before anything happens", async () => {
    for (const bad of ["https://web.push.apple.com/other-user-device", OTHER.slice(0, 8), "/requisitions/" + REQ, "https://evil.example.com", "javascript:alert(1)",
      { userId: OTHER, requisitionId: REQ } as unknown as string, { endpoint: "https://evil" } as unknown as string, [REQ] as unknown as string]) {
      expect(await sendTestPush(bad)).toEqual({ ok: false, error: "Choose a requisition." });
    }
    expect(webpushSend).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("9. rejects malformed requisition ids", async () => {
    for (const bad of ["", "not-a-uuid", "0b6f0f9e-1c2d-4e3f-8a9b", `${REQ}x`, null as unknown as string]) {
      expect(await sendTestPush(bad)).toEqual({ ok: false, error: "Choose a requisition." });
    }
  });

  it("10/11. rejects a requisition that doesn't exist or isn't visible to the administrator (row-level security)", async () => {
    expect(await sendTestPush(HIDDEN_REQ)).toEqual({ ok: false, error: "That requisition could not be found." });
    expect(calls.find((c) => c.op === "requisitions.eq")).toMatchObject({ client: "user", args: ["id", HIDDEN_REQ] });
    expect(webpushSend).not.toHaveBeenCalled();
    expect(rpcs()).toEqual([]); // not even a rate-limit slot is used
  });

  it("12/13. the payload is fixed and deep-links to exactly /requisitions/<UUID>", async () => {
    await sendTestPush(REQ);
    const payload = JSON.parse(webpushSend.mock.calls[0][1] as string);
    expect(Object.keys(payload).sort()).toEqual(["body", "tag", "title", "url"]);
    expect(payload.title).toBe("The Kings Tribe");
    expect(payload.body).toBe("Notification test — tap to open requisition");
    expect(payload.url).toBe(`/requisitions/${REQ}`);
    expect(payload.tag).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(JSON.stringify(payload)).not.toMatch(/\$|@|TKT-REQ/);
  });

  it("14/15/16/17. writes nothing but subscription health: no inbox row, email, workflow history, receipt, PO or vendor order", async () => {
    await sendTestPush(REQ);
    expect(writes()).toEqual([]);
    expect(calls.filter((c) => c.op.startsWith("from:")).map((c) => `${c.client}:${c.op}`)).toEqual(["user:from:requisitions", "admin:from:push_subscriptions"]);
    expect(rpcs()).toEqual(["rpc:consume_rate_limit", "rpc:consume_rate_limit", "rpc:record_push_results"]);
    const recorded = calls.find((c) => c.op === "rpc:record_push_results")!.args[0] as { p_results: unknown[] };
    expect(recorded.p_results).toEqual([{ notification_id: null, subscription_id: "a1", outcome: "sent" }]);
    expect(notify.notifyRequisitionSubmitted).not.toHaveBeenCalled();
    expect(notify.notifyStatusChange).not.toHaveBeenCalled();
  });

  it("18. endpoint allowlist is still enforced (a stored non-push-service endpoint is never contacted)", async () => {
    subscriptionsByUser[ADMIN.id] = [SUB("bad", "https://evil.example.com/push"), SUB("ok")];
    const r = await sendTestPush(REQ);
    expect(r).toMatchObject({ ok: true, data: { devices: 2, sent: 1 } });
    expect(webpushSend).toHaveBeenCalledTimes(1);
    expect((webpushSend.mock.calls[0][0] as { endpoint: string }).endpoint).toBe("https://web.push.apple.com/device-ok");
  });

  it("one send per device, no retries; failures are reported without details", async () => {
    subscriptionsByUser[ADMIN.id] = [SUB("a1"), SUB("a2")];
    webpushSend.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 })).mockRejectedValueOnce(Object.assign(new Error("Server"), { statusCode: 503 }));
    expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "The push service did not accept the test notification." });
    expect(webpushSend).toHaveBeenCalledTimes(2);
    const recorded = calls.find((c) => c.op === "rpc:record_push_results")!.args[0] as { p_results: { outcome: string }[] };
    expect(recorded.p_results.map((r) => r.outcome)).toEqual(["gone", "failed"]);
  });

  it("19. missing VAPID configuration fails safely before anything is sent or recorded", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "Phone notifications are not set up." });
    expect(webpushSend).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("20. rapid repeats are rejected by the rate limit (1 per minute, 5 per hour) without sending", async () => {
    rateLimitAllowed = false;
    expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "A test notification was sent recently. Please wait a minute before sending another." });
    expect(webpushSend).not.toHaveBeenCalled();
    const buckets = calls.filter((c) => c.op === "rpc:consume_rate_limit").map((c) => c.args[0]);
    expect(buckets[0]).toEqual({ p_bucket: `push-self-test:min:${ADMIN.id}`, p_max: 1, p_window_seconds: 60 });
  });

  it("no registered device: clear message, nothing sent", async () => {
    subscriptionsByUser[ADMIN.id] = [];
    expect(await sendTestPush(REQ)).toEqual({ ok: false, error: "No phone is registered for your account. Turn on phone notifications on your phone first." });
    expect(webpushSend).not.toHaveBeenCalled();
  });

  it("logs counts and the administrator's id only — never endpoints, keys or payloads", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendTestPush(REQ);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain(ADMIN.id);
    for (const secret of ["web.push.apple.com", "BPu7", "k7Yv", "pR1vAtE", REQ, "Notification test"]) expect(logged).not.toContain(secret);
  });

  it("the picker lists only requisitions visible to the administrator, with no personal details", async () => {
    const r = await listTestPushTargets();
    expect(r).toEqual({ ok: true, data: [{ id: REQ, requisition_number: "TKT-REQ-2026-0002", submitted_at: "2026-10-07T20:03:43Z" }] });
    expect(calls.find((c) => c.op === "requisitions.select")?.args).toEqual(["id, requisition_number, submitted_at"]);
  });

  it("the core uses the injected sender only in tests (the server action takes just the id)", async () => {
    const send = vi.fn(async () => ({}));
    await runPushSelfTest(ADMIN, REQ, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sendTestPush.length).toBe(1);
  });
});
