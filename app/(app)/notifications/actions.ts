"use server";

import { getSessionUser } from "@/lib/auth";
import { toActionError, ActionError, type ActionResult } from "@/lib/action-result";
import { getRecentNotifications, getUnreadCount } from "@/lib/notifications/queries";
import type { UserNotification } from "@/lib/notifications/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSession() {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  return user;
}

/** Bell: unread count plus the most recent items (own rows only, via RLS). */
export async function loadNotificationPanel(): Promise<ActionResult<{ unread: number; items: UserNotification[] }>> {
  try {
    await requireSession();
    const [unread, items] = await Promise.all([getUnreadCount(), getRecentNotifications()]);
    return { ok: true, data: { unread, items } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function loadUnreadCount(): Promise<ActionResult<number>> {
  try {
    await requireSession();
    return { ok: true, data: await getUnreadCount() };
  } catch (e) {
    return toActionError(e);
  }
}

/** Marks ONE of the signed-in user's notifications read (the database ignores anyone else's id). */
export async function markNotificationRead(id: string): Promise<ActionResult<{ unread: number }>> {
  try {
    await requireSession();
    if (typeof id !== "string" || !UUID.test(id)) throw new ActionError("That notification could not be found.");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
    if (error) throw new ActionError("The notification could not be updated. Please try again.");
    return { ok: true, data: { unread: await getUnreadCount() } };
  } catch (e) {
    return toActionError(e);
  }
}

/** Marks all of the signed-in user's notifications read. */
export async function markAllNotificationsRead(): Promise<ActionResult<{ unread: number }>> {
  try {
    await requireSession();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_all_notifications_read");
    if (error) throw new ActionError("Notifications could not be updated. Please try again.");
    return { ok: true, data: { unread: await getUnreadCount() }, message: "All notifications marked as read." };
  } catch (e) {
    return toActionError(e);
  }
}
