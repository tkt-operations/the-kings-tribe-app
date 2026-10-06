import { describe, expect, it } from "vitest";
import { describeEmailStatus, parseDeliveryEvent, TRACKED_EVENTS } from "@/lib/email/delivery-events";
import { isPublicPath } from "@/lib/route-access";

const event = (type: string, data: Record<string, unknown> = {}) => ({
  type, created_at: "2026-10-07T10:00:05.000Z",
  data: { email_id: "01a11307-19a4-7f18-962f-f05382136494", created_at: "2026-10-07T10:00:00.000Z", from: "x", to: ["person@example.org"], subject: "Private subject", ...data },
});

describe("parseDeliveryEvent", () => {
  it("maps every tracked Resend event type", () => {
    expect(Object.keys(TRACKED_EVENTS)).toEqual(["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"]);
    for (const [type, status] of Object.entries(TRACKED_EVENTS)) {
      expect(parseDeliveryEvent(event(type))).toMatchObject({ kind: "tracked", status, emailId: "01a11307-19a4-7f18-962f-f05382136494", occurredAt: "2026-10-07T10:00:05.000Z" });
    }
  });

  it("keeps only a short safe reason and drops recipients/subject", () => {
    const b = parseDeliveryEvent(event("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: "long text with person@example.org" } }));
    expect(b).toMatchObject({ detail: "Permanent / Suppressed" });
    expect(JSON.stringify(b)).not.toMatch(/person@example\.org|Private subject/);
    expect(parseDeliveryEvent(event("email.failed", { failed: { reason: "reached_daily_quota" } }))).toMatchObject({ detail: "reached_daily_quota" });
    expect(parseDeliveryEvent(event("email.suppressed", { suppressed: { type: "OnAccountSuppressionList", message: "…" } }))).toMatchObject({ detail: "OnAccountSuppressionList" });
    expect(parseDeliveryEvent(event("email.delivered"))).toMatchObject({ detail: null });
  });

  it("ignores untracked events and rejects malformed ones", () => {
    expect(parseDeliveryEvent(event("email.opened"))).toMatchObject({ kind: "ignored" });
    expect(parseDeliveryEvent(event("email.received"))).toMatchObject({ kind: "ignored" });
    expect(parseDeliveryEvent({ type: "email.delivered", created_at: "2026-10-07T10:00:00Z", data: { email_id: "x y" } })).toMatchObject({ kind: "invalid" });
    expect(parseDeliveryEvent({ type: "email.delivered", created_at: "not a date", data: { email_id: "abcdef12" } })).toMatchObject({ kind: "invalid" });
    expect(parseDeliveryEvent(null)).toMatchObject({ kind: "invalid" });
  });
});

describe("describeEmailStatus", () => {
  it("never calls an accepted email Delivered without a provider event", () => {
    expect(describeEmailStatus({ channel: "email", status: "sent", delivery_status: null })).toEqual({ app: "Accepted by Resend", provider: null, tone: "neutral" });
    expect(describeEmailStatus({ channel: "email", status: "sent", delivery_status: "delivered" })).toMatchObject({ app: "Accepted by Resend", provider: "Delivered", tone: "positive" });
    expect(describeEmailStatus({ channel: "email", status: "sent", delivery_status: "bounced" })).toMatchObject({ provider: "Bounced", tone: "negative" });
    expect(describeEmailStatus({ channel: "email", status: "sent", delivery_status: "delivery_delayed" })).toMatchObject({ provider: "Delayed", tone: "attention" });
    expect(describeEmailStatus({ channel: "email", status: "skipped", delivery_status: null }).app).toBe("Not sent (skipped)");
    expect(describeEmailStatus({ channel: "email", status: "failed", delivery_status: null }).app).toBe("Not accepted by Resend");
  });
});

describe("route access", () => {
  it("lets Resend reach the webhook without a session (signature-verified instead)", () => {
    expect(isPublicPath("/api/email-events")).toBe(true);
    expect(isPublicPath("/api/email-events-other")).toBe(false);
  });
});
