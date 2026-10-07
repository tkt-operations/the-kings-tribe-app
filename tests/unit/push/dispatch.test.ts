/** Dispatcher: VAPID gating, idempotent claim, outcomes, privacy of payloads and logs. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));
const { dispatchPendingPushes, classifyPushError } = await import("@/lib/push/dispatch");

const CONFIG = { publicKey: "P".repeat(87), privateKey: "S".repeat(43), subject: "mailto:ops@example.org" };
const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const row = (i: number, over: Record<string, unknown> = {}) => ({
  notification_id: `n-${i}`, subscription_id: `s-${i}`, endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`,
  p256dh: "BPu7ShjHv_X1lC3h5i_vG0oR0Ksw0C9bJZzYk1b8ZtQe2sB9Yl3n5vGgK1w5kq7T3x2b0Rk8yWQn4T6m0gX1a2c", auth: "k7Yv2XsL3qN9pR1tUwZ0aQ",
  type: "requisition.submitted", importance: "normal", link: `/requisitions/${REQ}`, unread: 2, ...over,
});
let claimRows: unknown[];
let recorded: unknown;

beforeEach(() => {
  rpc.mockReset();
  claimRows = [];
  recorded = null;
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_push_batch") return { data: claimRows, error: null };
    if (name === "record_push_results") {
      recorded = args.p_results;
      return { data: null, error: null };
    }
    return { data: null, error: { code: "XX" } };
  });
});

describe("dispatchPendingPushes", () => {
  it("does nothing (and claims nothing) when VAPID is not configured", async () => {
    const send = vi.fn();
    expect(await dispatchPendingPushes({ config: null, send })).toMatchObject({ status: "not_configured", claimed: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a minimal generic payload to each claimed device and records results", async () => {
    claimRows = [row(1), row(2, { notification_id: "n-1", importance: "high" })];
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const summary = await dispatchPendingPushes({ config: CONFIG, send });
    expect(summary).toEqual({ status: "done", claimed: 1, sent: 2, gone: 0, failed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_push_batch", { p_window_minutes: 30, p_limit: 50 });
    const [subscription, payload, options] = send.mock.calls[0] as unknown as [{ endpoint: string; keys: object }, string, Record<string, unknown>];
    expect(subscription.endpoint).toBe("https://fcm.googleapis.com/fcm/send/device-1");
    expect(JSON.parse(payload)).toEqual({ title: "The Kings Tribe", body: "New requisition requires review", url: `/requisitions/${REQ}`, tag: "n-1", badge: 2 });
    expect(options).toMatchObject({ TTL: 43200, timeout: 10000, urgency: "normal", vapidDetails: { subject: CONFIG.subject, publicKey: CONFIG.publicKey, privateKey: CONFIG.privateKey } });
    expect((send.mock.calls[1] as unknown as [unknown, string, { urgency: string }])[2].urgency).toBe("high");
    expect(recorded).toEqual([
      { notification_id: "n-1", subscription_id: "s-1", outcome: "sent" },
      { notification_id: "n-1", subscription_id: "s-2", outcome: "sent" },
    ]);
    // Logs carry counts only — never endpoints, keys, payloads or the private key.
    const logged = JSON.stringify(info.mock.calls);
    for (const secret of ["fcm.googleapis.com", "BPu7", "k7Yv", CONFIG.privateKey, "Receipt", "requisitions/"]) expect(logged).not.toContain(secret);
    info.mockRestore();
  });

  it("classifies 404/410 as gone and other failures (5xx, timeouts) as transient", async () => {
    claimRows = [row(1), row(2), row(3), row(4)];
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }))
      .mockRejectedValueOnce(Object.assign(new Error("Server"), { statusCode: 503 }))
      .mockRejectedValueOnce(new Error("socket hang up"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    const summary = await dispatchPendingPushes({ config: CONFIG, send });
    expect(summary).toMatchObject({ sent: 0, gone: 2, failed: 2 });
    expect((recorded as { outcome: string }[]).map((r) => r.outcome)).toEqual(["gone", "gone", "failed", "failed"]);
    expect(classifyPushError({ statusCode: 413 })).toBe("failed");
  });

  it("never POSTs to an endpoint outside the push-service allowlist (treated as gone)", async () => {
    claimRows = [row(1, { endpoint: "https://evil.example.com/push" })];
    const send = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await dispatchPendingPushes({ config: CONFIG, send });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toEqual([{ notification_id: "n-1", subscription_id: "s-1", outcome: "gone" }]);
  });

  it("an empty claim sends nothing; a claim error is reported without details", async () => {
    const send = vi.fn();
    expect(await dispatchPendingPushes({ config: CONFIG, send })).toMatchObject({ status: "done", claimed: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "secret detail" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await dispatchPendingPushes({ config: CONFIG, send })).toMatchObject({ status: "error" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret detail");
    warn.mockRestore();
  });

  it("a push failure never throws out of the dispatcher", async () => {
    claimRows = [row(1)];
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(dispatchPendingPushes({ config: CONFIG, send: async () => { throw new Error("boom"); } })).resolves.toMatchObject({ failed: 1 });
  });
});
