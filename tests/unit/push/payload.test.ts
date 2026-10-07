/** Endpoint allowlist (SSRF) and lock-screen payload privacy. */
import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "@/lib/push/endpoints";
import { buildPushPayload, PUSH_TITLE, pushBody } from "@/lib/push/payload";

const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

describe("push endpoints", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QOaB1-xyz",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("allows the browser push service %s", (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.com/x", "https://evil.example.com/fcm.googleapis.com/x",
    "https://user:pass@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://127.0.0.1/x", "https://169.254.169.254/latest",
    "https://metadata.google.internal/", "javascript:alert(1)", "https://fcm.googleapis.com/", `https://fcm.googleapis.com/${"a".repeat(2100)}`, 42, null,
  ])("rejects %j", (url) => expect(isAllowedPushEndpoint(url)).toBe(false));
});

describe("push payload privacy", () => {
  const TYPES = ["requisition.submitted", "requisition.assigned", "requisition.approved", "requisition.partially_approved", "purchase_order.issued",
    "purchase_order.voided", "vendor_order.cancelled", "receipt.received", "receipt.unmatched", "requisition.purchased", "something.new"];

  it("uses a fixed title and short pre-written lines — never database text, amounts or names", () => {
    for (const type of TYPES) {
      for (const importance of ["high", "normal"]) {
        const body = pushBody(type, importance);
        expect(body.length).toBeLessThanOrEqual(60);
        expect(body).not.toMatch(/[$\d@]/);
      }
    }
    expect(pushBody("requisition.submitted", "normal")).toBe("New requisition requires review");
    expect(pushBody("requisition.submitted", "high")).toBe("Essential requisition requires review");
    expect(pushBody("receipt.received", "normal")).toBe("Receipt ready to reconcile");
    expect(pushBody("requisition.assigned", "normal")).toBe("Requisition assigned to you");
    expect(pushBody("unknown.type", "normal")).toBe("You have a new notification");
  });

  it("builds a minimal payload with an allowlisted link, the notification id as tag and the badge count", () => {
    const p = buildPushPayload({ notificationId: "n-1", type: "receipt.received", importance: "normal", link: `/requisitions/${REQ}`, unread: 4 });
    expect(p).toEqual({ title: PUSH_TITLE, body: "Receipt ready to reconcile", url: `/requisitions/${REQ}`, tag: "n-1", badge: 4 });
    expect(Object.keys(p).sort()).toEqual(["badge", "body", "tag", "title", "url"]);
    expect(buildPushPayload({ notificationId: "n", type: "x.y", importance: "normal", link: "https://evil.example.com", unread: -3 })).toMatchObject({ url: "/notifications", badge: 0 });
    expect(buildPushPayload({ notificationId: "n", type: "x.y", importance: "normal", link: "/receipts", unread: 5000 }).badge).toBe(999);
  });
});
