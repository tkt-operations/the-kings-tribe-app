"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { announceNotificationsChanged } from "@/components/notifications/events";
import { NotificationItem } from "@/components/notifications/notification-item";
import type { UserNotification } from "@/lib/notifications/types";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export function NotificationList({ rows, now, timeZone, emptyMessage }: { rows: UserNotification[]; now: number; timeZone?: string; emptyMessage: string }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(rows);
  const [busy, setBusy] = useState(false);
  const anyUnread = items.some((n) => !n.read_at);

  async function markRead(n: UserNotification) {
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    const result = await markNotificationRead(n.id).catch(() => null);
    if (!result?.ok) toast.error(result && !result.ok ? result.error : "The notification could not be updated. Please try again.");
    announceNotificationsChanged();
    router.refresh();
  }

  async function open(n: UserNotification, href: string) {
    if (!n.read_at) {
      await markNotificationRead(n.id).catch(() => null);
      announceNotificationsChanged();
    }
    router.push(href);
  }

  async function markAll() {
    setBusy(true);
    const result = await markAllNotificationsRead().catch(() => null);
    setBusy(false);
    if (result?.ok) {
      setItems((list) => list.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
      toast.success(result.message ?? "All notifications marked as read.");
    } else {
      toast.error(result && !result.ok ? result.error : "Notifications could not be updated. Please try again.");
    }
    announceNotificationsChanged();
    router.refresh();
  }

  return (
    <section aria-label="Notifications" className="rounded-[var(--radius-card)] bg-white p-2 ring-1 ring-navy/10 sm:p-3">
      <div className="flex items-center justify-end border-b border-navy/10 px-1 pb-2">
        <button
          type="button"
          onClick={() => void markAll()}
          disabled={!anyUnread || busy}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-navy hover:bg-navy/5 disabled:cursor-not-allowed disabled:text-navy/35"
        >
          <CheckCheck className="size-4" aria-hidden /> Mark all as read
        </button>
      </div>
      {items.length === 0 ? (
        <div className="p-2"><EmptyState title="Nothing here">{emptyMessage}</EmptyState></div>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((n) => <NotificationItem key={n.id} n={n} now={now} timeZone={timeZone} onOpen={open} onMarkRead={markRead} />)}
        </ul>
      )}
    </section>
  );
}
