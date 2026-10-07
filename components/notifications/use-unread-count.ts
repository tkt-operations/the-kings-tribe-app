"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { POLL_INTERVAL_MS } from "@/lib/notifications/types";
import { loadUnreadCount } from "@/app/(app)/notifications/actions";
import { updateAppBadge } from "./badge";
import { NOTIFICATIONS_CHANGED } from "./events";

/**
 * Live unread count for the signed-in user.
 *  - Supabase Realtime on user_notifications (RLS limits events to the user's own rows)
 *  - fallback: refresh on window focus / when the tab becomes visible, and every
 *    60 s while visible — so it stays correct when Realtime is unavailable.
 * `version` increases whenever something may have changed (for the open panel).
 */
export function useUnreadCount(userId: string, initial: number) {
  const [unread, setUnread] = useState(initial);
  const [version, setVersion] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await loadUnreadCount();
      if (result.ok) setUnread(result.data);
    } catch {
      // Keep the last known count; the next trigger retries.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const changed = () => {
      setVersion((v) => v + 1);
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") changed();
    };
    window.addEventListener("focus", changed);
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);

    let stopRealtime = () => {};
    try {
      const supabase = createSupabaseBrowserClient();
      const channel = supabase
        .channel(`user-notifications:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "user_notifications", filter: `user_id=eq.${userId}` }, changed)
        .subscribe();
      stopRealtime = () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      // Realtime unavailable: focus/visibility/polling keep the count fresh.
    }

    return () => {
      window.removeEventListener("focus", changed);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      stopRealtime();
    };
  }, [userId, refresh]);

  // Installed-app badge mirrors the unread count (no-op where unsupported).
  useEffect(() => {
    updateAppBadge(unread);
  }, [unread]);

  return { unread, setUnread, version, refresh };
}
