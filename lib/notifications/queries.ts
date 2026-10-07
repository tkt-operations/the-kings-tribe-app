import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAttentionCards, type AttentionCard } from "@/lib/notifications/attention";
import { PAGE_SIZE, PANEL_LIMIT, type NotificationFilter, type UserNotification } from "@/lib/notifications/types";

/**
 * Inbox reads use the signed-in user's own client: RLS returns only their own
 * rows, and only while they still hold the permission each row requires.
 */
const COLUMNS = "id, type, category, importance, title, body, link, requisition_id, read_at, created_at";

export async function getUnreadCount(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("unread_notification_count");
  if (error) return 0;
  return Number(data ?? 0);
}

export async function getRecentNotifications(limit = PANEL_LIMIT): Promise<UserNotification[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("user_notifications").select(COLUMNS).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as UserNotification[];
}

export async function listNotifications(filter: NotificationFilter, page: number): Promise<{ rows: UserNotification[]; total: number; pages: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("user_notifications").select(COLUMNS, { count: "exact" }).order("created_at", { ascending: false });
  if (filter === "unread") query = query.is("read_at", null);
  else if (filter !== "all") query = query.eq("category", filter);
  const safePage = Math.max(1, Math.min(1000, Math.floor(page) || 1));
  const { data, count } = await query.range((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE - 1);
  const total = count ?? 0;
  return { rows: (data ?? []) as UserNotification[], total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getNeedsAttention(): Promise<AttentionCard[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_needs_attention");
  if (error) return [];
  return toAttentionCards(data);
}
