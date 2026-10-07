/** Client-safe notification helpers: links, labels, times, Needs Attention cards, route access. */
import { describe, expect, it } from "vitest";
import { isRequisitionAttentionCard, toAttentionCards } from "@/lib/notifications/attention";
import { absoluteTime, relativeTime } from "@/lib/notifications/format";
import { isSafeNotificationLink, safeNotificationLink } from "@/lib/notifications/links";
import { bellLabel, isNotificationFilter, unreadBadge } from "@/lib/notifications/types";
import { isPublicPath } from "@/lib/route-access";

describe("safe notification links", () => {
  it.each(["/requisitions/0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", "/receipts", "/dashboard", "/notifications"])("allows %s", (link) => {
    expect(isSafeNotificationLink(link)).toBe(true);
    expect(safeNotificationLink(link)).toBe(link);
  });

  it.each([
    "https://evil.example.com", "//evil.example.com", "/\\evil.example.com", "javascript:alert(1)", "/requisitions/../admin",
    "/requisitions/not-a-uuid", "/admin/users", "/receipts?next=//evil", "/notifications/abc", "", null, undefined, 42, { link: "/receipts" },
  ])("rejects %j (falls back to /notifications)", (link) => {
    expect(isSafeNotificationLink(link)).toBe(false);
    expect(safeNotificationLink(link)).toBe("/notifications");
  });
});

describe("labels", () => {
  it("caps the badge at 9+ and gives the bell an accessible count", () => {
    expect(unreadBadge(1)).toBe("1");
    expect(unreadBadge(9)).toBe("9");
    expect(unreadBadge(10)).toBe("9+");
    expect(unreadBadge(250)).toBe("9+");
    expect(bellLabel(0)).toBe("Notifications, no unread");
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
  });

  it("accepts only known filters", () => {
    for (const f of ["all", "unread", "requisitions", "purchasing", "finance", "system"]) expect(isNotificationFilter(f)).toBe(true);
    for (const f of ["", "read", "admin", null, 1]) expect(isNotificationFilter(f)).toBe(false);
  });
});

describe("times", () => {
  const now = Date.parse("2026-10-07T15:00:00Z");
  it("is relative for recent items and a date for older ones", () => {
    expect(relativeTime("2026-10-07T14:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-07T14:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-07T12:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-06T15:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-09-01T15:00:00Z", now)).toBe("Sep 1");
    expect(relativeTime("2025-09-01T15:00:00Z", now)).toBe("Sep 1, 2025");
    expect(relativeTime("nope", now)).toBe("");
  });
  it("gives a full timestamp in the church timezone", () => {
    expect(absoluteTime("2026-10-07T15:00:00Z", "America/Chicago")).toBe("Oct 7, 2026, 10:00 AM");
  });
});

describe("Needs Attention cards", () => {
  it("maps the database result into ordered cards with links", () => {
    const cards = toAttentionCards({
      on_hold: { count: 1 },
      awaiting_review: { count: 4, essential: 2, assigned_to_me: 1, oldest: "2026-10-01T00:00:00Z" },
      receipts_to_reconcile: { count: 2, unmatched: 1 },
      ready_for_po: { count: 0 },
    });
    expect(cards.map((c) => [c.key, c.count, c.href])).toEqual([
      ["awaiting_review", 4, "/requisitions?attention=awaiting_review"],
      ["receipts_to_reconcile", 3, "/receipts"],
      ["ready_for_po", 0, "/requisitions?attention=ready_for_po"],
      ["on_hold", 1, "/requisitions?attention=on_hold"],
    ]);
    expect(cards[0]).toMatchObject({ details: ["2 Essential", "1 assigned to you"], emphasis: true });
    expect(cards[1].details).toEqual(["1 unmatched"]);
  });

  it("shows nothing the user may not act on (missing keys) and tolerates bad input", () => {
    expect(toAttentionCards({})).toEqual([]);
    expect(toAttentionCards(null)).toEqual([]);
    expect(toAttentionCards("x")).toEqual([]);
  });

  it("accepts only requisition card keys for the list filter", () => {
    expect(isRequisitionAttentionCard("awaiting_review")).toBe(true);
    expect(isRequisitionAttentionCard("receipts_to_reconcile")).toBe(false);
    expect(isRequisitionAttentionCard("'; drop table")).toBe(false);
  });
});

describe("routes", () => {
  it("keeps the public requester page public and the internal inbox private", () => {
    expect(isPublicPath("/notifications/0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isPublicPath("/notifications")).toBe(false);
  });
});
