/** Same-tab signal that the inbox changed (e.g. "Mark all as read" on /notifications), so the bell refreshes. */
export const NOTIFICATIONS_CHANGED = "tkt:notifications-changed";

export function announceNotificationsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}
