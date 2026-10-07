import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { getChurchSettings } from "@/lib/data/settings";
import { listNotifications } from "@/lib/notifications/queries";
import { FILTER_LABELS, isNotificationFilter, NOTIFICATION_FILTERS, type NotificationFilter } from "@/lib/notifications/types";
import { NotificationList } from "./notification-list";

export const metadata = { title: "Notifications" };

/** Rendered per request; used as the reference time for "5 minutes ago". */
function requestTime(): number {
  return Date.now();
}

/**
 * The signed-in user's operational inbox. (The public requester page
 * /notifications/[token] is a different, unauthenticated route and is unchanged.)
 */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await requireUser();
  const params = await searchParams;
  const filter: NotificationFilter = isNotificationFilter(params.filter) ? params.filter : "all";
  const page = Math.max(1, Math.min(1000, Number(typeof params.page === "string" ? params.page : 1) || 1));
  const [{ rows, total, pages }, settings] = await Promise.all([listNotifications(filter, page), getChurchSettings()]);
  const href = (f: NotificationFilter, p = 1) => {
    const sp = new URLSearchParams();
    if (f !== "all") sp.set("filter", f);
    if (p > 1) sp.set("page", String(p));
    const q = sp.toString();
    return q ? `/notifications?${q}` : "/notifications";
  };

  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" description="Activity that involves you. Needs Attention on the dashboard shows the work still waiting." />
      <nav aria-label="Notification filters" className="-mx-1 mb-4 overflow-x-auto pb-1">
        <ul className="flex w-max gap-1.5 px-1">
          {NOTIFICATION_FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={href(f)}
                aria-current={f === filter ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ring-1",
                  f === filter ? "bg-navy text-gold ring-navy" : "bg-white text-navy/75 ring-navy/15 hover:ring-navy/30",
                )}
              >
                {FILTER_LABELS[f]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <NotificationList
        key={`${filter}-${page}`}
        rows={rows}
        now={requestTime()}
        timeZone={settings?.timezone ?? undefined}
        emptyMessage={filter === "unread" ? "No unread notifications." : filter === "all" ? "No notifications yet." : `No ${FILTER_LABELS[filter].toLowerCase()} notifications.`}
      />
      {pages > 1 || total > 0 ? (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-navy/60">{total} notification{total === 1 ? "" : "s"}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={href(filter, page - 1)} className="inline-flex min-h-11 items-center rounded-xl px-3 ring-1 ring-navy/15 hover:bg-white">Previous</Link> : null}
            {page < pages ? <Link href={href(filter, page + 1)} className="inline-flex min-h-11 items-center rounded-xl px-3 ring-1 ring-navy/15 hover:bg-white">Next</Link> : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
