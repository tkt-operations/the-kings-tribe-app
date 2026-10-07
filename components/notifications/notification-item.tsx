"use client";

import Link from "next/link";
import { Check, ClipboardList, Info, ShoppingCart, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { absoluteTime, relativeTime } from "@/lib/notifications/format";
import { safeNotificationLink } from "@/lib/notifications/links";
import { CATEGORY_LABELS, type NotificationCategory, type UserNotification } from "@/lib/notifications/types";

const ICONS: Record<NotificationCategory, typeof Info> = {
  requisitions: ClipboardList,
  purchasing: ShoppingCart,
  finance: Wallet,
  system: Info,
};

/**
 * One notification. Selecting it marks it read and opens its (server-generated,
 * allowlisted) link; the separate check button only marks it read.
 */
export function NotificationItem({
  n,
  now,
  onOpen,
  onMarkRead,
  timeZone,
}: {
  n: UserNotification;
  now: number;
  onOpen: (n: UserNotification, href: string) => void;
  onMarkRead: (n: UserNotification) => void;
  timeZone?: string;
}) {
  const Icon = ICONS[n.category] ?? Info;
  const unread = !n.read_at;
  const href = safeNotificationLink(n.link);
  const when = absoluteTime(n.created_at, timeZone);
  return (
    <li className={cn("relative flex gap-3 rounded-xl px-3 py-3", unread ? "bg-gold/[0.08]" : "")}>
      <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", n.importance === "high" ? "bg-energy-orange/15 text-navy" : "bg-navy/[0.06] text-navy/70")} aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onOpen(n, href);
          }}
          className="block rounded-md focus:outline-none focus-visible:ring-4 focus-visible:ring-gold/40"
        >
          <span className="sr-only">{unread ? "Unread. " : ""}{n.importance === "high" ? "Important. " : ""}{CATEGORY_LABELS[n.category]}: </span>
          <span className={cn("block break-words text-[15px] leading-snug", unread ? "font-bold text-navy" : "font-medium text-navy/80")}>{n.title}</span>
          {n.body ? <span className="mt-0.5 block break-words text-[13px] text-navy/65">{n.body}</span> : null}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-navy/55">
          <time dateTime={n.created_at} title={when} suppressHydrationWarning>{relativeTime(n.created_at, now)}</time>
          <span aria-hidden>·</span>
          <span>{CATEGORY_LABELS[n.category]}</span>
          {n.importance === "high" ? <span className="rounded-full bg-energy-orange/15 px-1.5 py-0.5 font-bold text-navy">Important</span> : null}
        </p>
      </div>
      {unread ? (
        <button
          type="button"
          onClick={() => onMarkRead(n)}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-navy/60 hover:bg-navy/5 hover:text-navy focus:outline-none focus-visible:ring-4 focus-visible:ring-gold/40"
          aria-label={`Mark "${n.title}" as read`}
          title="Mark as read"
        >
          <Check className="size-4" aria-hidden />
        </button>
      ) : null}
      {unread ? <span className="absolute left-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-energy-orange" aria-hidden /> : null}
    </li>
  );
}
