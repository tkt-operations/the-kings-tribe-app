import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { describeEmailStatus, type NotificationRow } from "@/lib/email/delivery-events";


/**
 * Internal notification log. "Accepted by Resend" (the app's send call
 * succeeded) is shown separately from the provider's delivery status, which
 * only comes from signed Resend webhooks.
 */
export function NotificationLog({ notifications, timezone }: { notifications: NotificationRow[]; timezone: string }) {
  if (!notifications.length) return null;
  return (
    <>
      <p className="mb-2 mt-5 text-sm font-bold">Notifications</p>
      <ul className="space-y-2.5 text-[13px] text-navy/75">
        {notifications.map((n) => {
          const s = describeEmailStatus(n);
          const reason = [...(n.notification_events ?? [])].filter((e) => e.detail).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0]?.detail;
          return (
            <li key={n.id} className="border-b border-navy/5 pb-2 last:border-0" data-testid="notification-row">
              <p className="font-medium text-navy">{n.template.replace(/_/g, " ")} <span className="font-normal text-navy/60">· {n.channel}</span></p>
              <p className="[overflow-wrap:anywhere]">To {n.recipient}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>{s.app} · {formatDateTime(n.created_at, timezone)}</span>
                {s.provider ? (
                  <Badge tone={s.tone}>
                    <span className="sr-only">Provider status: </span>{s.provider}
                  </Badge>
                ) : n.channel === "email" && n.status === "sent" ? (
                  <span className="text-navy/55">· No delivery update yet</span>
                ) : null}
              </p>
              {s.provider && n.delivery_status_at ? <p className="text-navy/60">{s.provider} {formatDateTime(n.delivery_status_at, timezone)}</p> : null}
              {reason ? <p className="text-navy/60">Reason: {reason}</p> : null}
              {n.error ? <p className="text-navy/60">{n.error}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
