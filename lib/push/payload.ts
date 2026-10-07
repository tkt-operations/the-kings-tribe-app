import { safeNotificationLink } from "@/lib/notifications/links";

/**
 * Lock-screen text is deliberately generic: a fixed title and one short,
 * pre-written line per event type. It never comes from database text, and
 * never includes amounts, items, names, contact details, receipt details,
 * financial coding or comments. Details are shown only inside the app, after
 * normal sign-in and permission checks.
 */
export const PUSH_TITLE = "The Kings Tribe";

const LINES: Record<string, string> = {
  "requisition.submitted": "New requisition requires review",
  "requisition.assigned": "Requisition assigned to you",
  "requisition.approved": "Approved requisition is ready for the next step",
  "requisition.partially_approved": "Approved requisition is ready for the next step",
  "purchase_order.issued": "Purchase order is ready to order",
  "purchase_order.voided": "A purchase order was voided",
  "vendor_order.cancelled": "A vendor order was cancelled",
  "receipt.received": "Receipt ready to reconcile",
  "receipt.unmatched": "Unmatched receipt needs assigning",
  "requisition.purchased": "Requisition is ready for reimbursement",
};
const FALLBACK = "You have a new notification";

export interface PushPayload {
  title: string;
  body: string;
  /** Allowlisted application path (checked again by the service worker). */
  url: string;
  /** Notification id: identical pushes replace each other instead of stacking. */
  tag: string;
  /** Unread count for the app badge. */
  badge: number;
}

export function pushBody(type: string, importance: string): string {
  if (type === "requisition.submitted" && importance === "high") return "Essential requisition requires review";
  return LINES[type] ?? FALLBACK;
}

export function buildPushPayload(n: { notificationId: string; type: string; importance: string; link: string; unread: number }): PushPayload {
  return {
    title: PUSH_TITLE,
    body: pushBody(n.type, n.importance),
    url: safeNotificationLink(n.link),
    tag: n.notificationId,
    badge: Number.isInteger(n.unread) && n.unread >= 0 ? Math.min(n.unread, 999) : 0,
  };
}
