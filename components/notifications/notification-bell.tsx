"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { bellLabel, unreadBadge, type UserNotification } from "@/lib/notifications/types";
import { loadNotificationPanel, markAllNotificationsRead, markNotificationRead } from "@/app/(app)/notifications/actions";
import { NotificationItem } from "./notification-item";
import { useUnreadCount } from "./use-unread-count";

/**
 * One notification center per app shell: a single live unread count (one
 * Realtime subscription), shared by the desktop and mobile bell buttons and a
 * single panel. Opening the panel never marks anything read.
 */
export function useNotificationBell(userId: string, initialUnread: number) {
  const router = useRouter();
  const { unread, setUnread, version, refresh } = useUnreadCount(userId, initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const load = useCallback(async () => {
    try {
      const result = await loadNotificationPanel();
      if (result.ok) {
        setItems(result.data.items);
        setUnread(result.data.unread);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Notifications could not be loaded.");
    }
    setNow(Date.now());
  }, [setUnread]);

  // Keep an open panel fresh when something changes (Realtime / focus / polling).
  const seenVersion = useRef(version);
  useEffect(() => {
    if (!open || seenVersion.current === version) return;
    seenVersion.current = version;
    void load();
  }, [open, version, load]);

  function toggle(button: HTMLButtonElement) {
    trigger.current = button;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void load();
  }

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  async function markRead(n: UserNotification) {
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? list);
    setUnread((c) => Math.max(0, c - 1));
    try {
      const result = await markNotificationRead(n.id);
      if (result.ok) setUnread(result.data.unread);
      else void load();
    } catch {
      void load();
    }
  }

  async function markAll() {
    setItems((list) => list?.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })) ?? list);
    setUnread(0);
    try {
      const result = await markAllNotificationsRead();
      if (result.ok) setUnread(result.data.unread);
      else void load();
    } catch {
      void load();
    }
  }

  async function openItem(n: UserNotification, href: string) {
    close(false);
    if (!n.read_at) {
      setUnread((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(n.id);
      } catch {
        // Navigation still proceeds; the count refreshes on the next change.
      }
    }
    router.push(href);
    void refresh();
  }

  return { unread, open, items, error, now, panelId, trigger, toggle, close, markRead, markAll, openItem, reload: load };
}

export type NotificationBellState = ReturnType<typeof useNotificationBell>;

export function BellButton({ bell, className }: { bell: NotificationBellState; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => bell.toggle(e.currentTarget)}
      aria-label={bellLabel(bell.unread)}
      aria-haspopup="dialog"
      aria-expanded={bell.open}
      aria-controls={bell.open ? bell.panelId : undefined}
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-gold/50",
        className,
      )}
    >
      <Bell className="size-5" aria-hidden />
      {bell.unread > 0 ? (
        <span aria-hidden className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-energy-orange px-1 text-[11px] font-bold leading-none text-white ring-2 ring-navy">
          {unreadBadge(bell.unread)}
        </span>
      ) : null}
    </button>
  );
}

export function NotificationPanel({ bell, timeZone }: { bell: NotificationBellState; timeZone?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { open, close } = bell;

  // Move focus into the panel once, when it opens.
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || bell.trigger.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close, bell.trigger]);

  if (!open) return null;
  const items = bell.items;
  return (
    <div
      ref={panel}
      id={bell.panelId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${bell.panelId}-title`}
      className="fixed inset-x-2 top-[calc(var(--safe-top)+4.5rem)] z-50 flex max-h-[calc(100dvh-9rem)] flex-col overflow-hidden rounded-2xl bg-white text-navy shadow-xl shadow-navy/20 ring-1 ring-navy/10 lg:inset-x-auto lg:left-[18.75rem] lg:top-6 lg:max-h-[min(36rem,calc(100dvh-3rem))] lg:w-[24rem]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-navy/10 px-4 py-3">
        <h2 ref={heading} id={`${bell.panelId}-title`} tabIndex={-1} className="font-serif text-xl focus:outline-none">
          Notifications
          {bell.unread > 0 ? <span className="ml-2 align-middle font-sans text-sm font-medium text-navy/60">{bell.unread} unread</span> : null}
        </h2>
        <button type="button" onClick={() => close()} className="flex size-11 items-center justify-center rounded-xl hover:bg-navy/5" aria-label="Close notifications">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {bell.error ? (
          <div className="px-3 py-6 text-center text-sm text-navy/70">
            <p>{bell.error}</p>
            <button type="button" onClick={() => void bell.reload()} className="mt-2 min-h-11 font-medium text-ministry-blue underline-offset-2 hover:underline">Try again</button>
          </div>
        ) : items === null ? (
          <p className="px-3 py-6 text-center text-sm text-navy/60" role="status">Loading notifications…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-navy/60">You&rsquo;re all caught up.</p>
        ) : (
          <ul className="space-y-1" aria-label="Recent notifications">
            {items.map((n) => (
              <NotificationItem key={n.id} n={n} now={bell.now} timeZone={timeZone} onOpen={bell.openItem} onMarkRead={bell.markRead} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy/10 px-3 py-2">
        <button
          type="button"
          onClick={() => void bell.markAll()}
          disabled={bell.unread === 0}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-navy hover:bg-navy/5 disabled:cursor-not-allowed disabled:text-navy/35"
        >
          <CheckCheck className="size-4" aria-hidden /> Mark all as read
        </button>
        <Link href="/notifications" onClick={() => close(false)} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-ministry-blue hover:bg-navy/5">
          View all notifications
        </Link>
      </div>
    </div>
  );
}
