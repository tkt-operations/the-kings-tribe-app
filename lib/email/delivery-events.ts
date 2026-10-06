/**
 * Resend webhook events we track (verified against Resend's event-type docs):
 * email.sent, email.delivered, email.delivery_delayed, email.bounced,
 * email.complained, email.failed, email.suppressed. Others (opened, clicked,
 * received, scheduled, …) are ignored here.
 */
export const TRACKED_EVENTS = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
} as const;

export type DeliveryStatus = (typeof TRACKED_EVENTS)[keyof typeof TRACKED_EVENTS];

export type ParsedDeliveryEvent =
  | { kind: "tracked"; status: DeliveryStatus; emailId: string; occurredAt: string; detail: string | null }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

const EMAIL_ID = /^[A-Za-z0-9_-]{6,100}$/;
const short = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/[^\w .:/-]/g, "").slice(0, max) : "");

/**
 * Reduce a verified webhook payload to what we store: status, provider email
 * id, event time and a short safe reason. Recipients, subject and bodies are
 * deliberately dropped.
 */
export function parseDeliveryEvent(payload: unknown): ParsedDeliveryEvent {
  if (!payload || typeof payload !== "object") return { kind: "invalid", reason: "payload is not an object" };
  const p = payload as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  const status = typeof p.type === "string" ? (TRACKED_EVENTS as Record<string, DeliveryStatus>)[p.type] : undefined;
  if (!status) return { kind: "ignored", reason: `untracked event type ${short(p.type, 60) || "(none)"}` };
  const emailId = typeof p.data?.email_id === "string" ? p.data.email_id : "";
  if (!EMAIL_ID.test(emailId)) return { kind: "invalid", reason: "missing or malformed email_id" };
  const when = typeof p.created_at === "string" ? p.created_at : typeof p.data?.created_at === "string" ? (p.data.created_at as string) : "";
  if (!when || Number.isNaN(Date.parse(when))) return { kind: "invalid", reason: "missing or malformed created_at" };

  let detail: string | null = null;
  const d = p.data ?? {};
  if (status === "bounced" && d.bounce && typeof d.bounce === "object") {
    const b = d.bounce as { type?: unknown; subType?: unknown };
    detail = [short(b.type, 40), short(b.subType, 60)].filter(Boolean).join(" / ") || null;
  } else if (status === "failed" && d.failed && typeof d.failed === "object") {
    detail = short((d.failed as { reason?: unknown }).reason) || null;
  } else if (status === "suppressed" && d.suppressed && typeof d.suppressed === "object") {
    detail = short((d.suppressed as { type?: unknown }).type) || null;
  }
  return { kind: "tracked", status, emailId, occurredAt: new Date(when).toISOString(), detail };
}

/** A notifications row with its provider delivery state (as loaded for the detail page). */
export interface NotificationRow {
  id: string;
  channel: string;
  template: string;
  recipient: string;
  status: string;
  error: string | null;
  created_at: string;
  delivery_status: DeliveryStatus | null;
  delivery_status_at: string | null;
  notification_events?: { event_type: DeliveryStatus; occurred_at: string; detail: string | null }[] | null;
}

const LABELS: Record<DeliveryStatus, string> = {
  sent: "Sent",
  delivery_delayed: "Delayed",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  suppressed: "Suppressed",
};

/** Concise, truthful status for the internal notification log. */
export function describeEmailStatus(n: { channel: string; status: string; delivery_status: DeliveryStatus | null }): { app: string; provider: string | null; tone: "positive" | "neutral" | "attention" | "negative" } {
  if (n.channel !== "email") return { app: n.status, provider: null, tone: n.status === "sent" ? "neutral" : n.status === "failed" ? "negative" : "neutral" };
  if (n.status === "skipped") return { app: "Not sent (skipped)", provider: null, tone: "neutral" };
  if (n.status === "failed") return { app: "Not accepted by Resend", provider: null, tone: "negative" };
  // status "sent" = Resend accepted the API request; delivery comes only from webhooks.
  if (!n.delivery_status) return { app: "Accepted by Resend", provider: null, tone: "neutral" };
  const tone = n.delivery_status === "delivered" ? "positive" : n.delivery_status === "sent" ? "neutral" : n.delivery_status === "delivery_delayed" ? "attention" : "negative";
  return { app: "Accepted by Resend", provider: LABELS[n.delivery_status], tone };
}
