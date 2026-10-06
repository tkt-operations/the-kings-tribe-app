/** /api/email-events: Svix signature verification and safe handling. */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const SECRET_BYTES = Buffer.from("test-only-delivery-webhook-key-0123456789");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`; // test fixture, not a real secret
let configured = true;
vi.mock("@/lib/server-env", () => ({ serverEnv: () => ({ resendDeliveryWebhookSecret: configured ? SECRET : "" }) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ isAdminClientConfigured: () => true, createSupabaseAdminClient: () => ({ rpc }) }));

const { POST } = await import("@/app/api/email-events/route");

function signed(body: string, opts: { id?: string; ts?: number; secret?: Buffer } = {}) {
  const id = opts.id ?? "msg_2abc";
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", opts.secret ?? SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("https://ops.example.org/api/email-events", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` } });
}
const payload = (type = "email.delivered", emailId = "01a11307-19a4-7f18-962f-f05382136494") =>
  JSON.stringify({ type, created_at: "2026-10-07T10:00:05.000Z", data: { email_id: emailId, to: ["a@example.org"], subject: "S" } });

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  configured = true;
  rpc.mockReset().mockResolvedValue({ data: { result: "recorded", delivery_status: "delivered" }, error: null });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("POST /api/email-events", () => {
  it("records a validly signed event using the Svix id and stored provider message id", async () => {
    const res = await POST(signed(payload(), { id: "msg_unique_1" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "recorded" });
    expect(rpc).toHaveBeenCalledWith("record_email_delivery_event", {
      p_provider_event_id: "msg_unique_1", p_provider_message_id: "01a11307-19a4-7f18-962f-f05382136494",
      p_event_type: "delivered", p_occurred_at: "2026-10-07T10:00:05.000Z", p_detail: null,
    });
  });

  it("rejects an invalid signature", async () => {
    const res = await POST(signed(payload(), { secret: Buffer.from("wrong-key") }) as never);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a tampered body", async () => {
    const req = signed(payload());
    const forged = new Request(req.url, { method: "POST", headers: req.headers, body: payload("email.delivered", "someone-elses-email-id") });
    expect((await POST(forged as never)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects missing signature headers", async () => {
    const res = await POST(new Request("https://ops.example.org/api/email-events", { method: "POST", body: payload() }) as never);
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects stale timestamps (replay window)", async () => {
    const res = await POST(signed(payload(), { ts: Math.floor(Date.now() / 1000) - 3600 }) as never);
    expect(res.status).toBe(401);
  });

  it("acknowledges untracked events without touching the database", async () => {
    const res = await POST(signed(payload("email.opened")) as never);
    expect(await res.json()).toEqual({ result: "ignored" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes duplicates and unknown ids through to the idempotent database function", async () => {
    rpc.mockResolvedValueOnce({ data: { result: "duplicate" }, error: null }).mockResolvedValueOnce({ data: { result: "unmatched" }, error: null });
    expect(await (await POST(signed(payload(), { id: "same" }) as never)).json()).toEqual({ result: "duplicate" });
    expect(await (await POST(signed(payload(), { id: "other" }) as never)).json()).toEqual({ result: "unmatched" });
  });

  it("returns 503 when not configured and 500 (retryable) on database errors, without leaking details", async () => {
    configured = false;
    expect((await POST(signed(payload()) as never)).status).toBe(503);
    configured = true;
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    const res = await POST(signed(payload()) as never);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/internal detail|whsec_/);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET);
  });
});
