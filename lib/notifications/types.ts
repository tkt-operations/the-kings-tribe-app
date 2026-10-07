/**
 * Operational user notifications (Release 1) — shared, client-safe types.
 * These are a user's in-app inbox ("Requisition … requires your review"),
 * NOT the email log (public.notifications). Rows are created only by database
 * triggers (migration 20261009000100).
 */

export const NOTIFICATION_CATEGORIES = ["requisitions", "purchasing", "finance", "system"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationImportance = "high" | "normal" | "low";

export interface UserNotification {
  id: string;
  type: string;
  category: NotificationCategory;
  importance: NotificationImportance;
  title: string;
  body: string | null;
  link: string;
  requisition_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Tabs on /notifications. */
export const NOTIFICATION_FILTERS = ["all", "unread", ...NOTIFICATION_CATEGORIES] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const FILTER_LABELS: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
  requisitions: "Requisitions",
  purchasing: "Purchasing",
  finance: "Finance",
  system: "System",
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  requisitions: "Requisition",
  purchasing: "Purchasing",
  finance: "Finance",
  system: "System",
};

export function isNotificationFilter(value: unknown): value is NotificationFilter {
  return typeof value === "string" && (NOTIFICATION_FILTERS as readonly string[]).includes(value);
}

export const PANEL_LIMIT = 10;
export const PAGE_SIZE = 25;
/** Fallback refresh while the page is visible (Realtime may be unavailable). */
export const POLL_INTERVAL_MS = 60_000;

/** "9+" style badge text. */
export function unreadBadge(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function bellLabel(count: number): string {
  return count === 0 ? "Notifications, no unread" : `Notifications, ${count} unread`;
}
