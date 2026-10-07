import "server-only";

import webpush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAllowedPushEndpoint } from "@/lib/push/endpoints";
import { buildPushPayload } from "@/lib/push/payload";
import { vapidConfig, type VapidConfig } from "@/lib/push/vapid";

/**
 * Best-effort Web Push delivery, run AFTER the workflow transaction has
 * committed (via `after()`), never inside it. The inbox row already exists and
 * is never changed here; a failed push only affects that alert.
 *
 * Idempotent: claim_push_batch claims each recent inbox row once (database
 * primary key), so concurrent or repeated dispatches never push it twice; the
 * service worker also collapses repeats by tag. Rows older than the window are
 * not pushed late. A missed dispatch is picked up by the next one.
 */
export const DISPATCH_WINDOW_MINUTES = 30;
const BATCH_LIMIT = 50;
const CONCURRENCY = 8;
const SEND_TIMEOUT_MS = 10_000;
const TTL_SECONDS = 12 * 60 * 60;

interface ClaimRow {
  notification_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  type: string;
  importance: string;
  link: string;
  unread: number;
}

export type Outcome = "sent" | "gone" | "failed";

export interface DispatchSummary {
  status: "not_configured" | "error" | "done";
  claimed: number;
  sent: number;
  gone: number;
  failed: number;
}

export type Sender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/**
 * Send one payload to one subscription with the standard VAPID options. The
 * endpoint must be an allowlisted push service (never POST anywhere else).
 * Shared by the dispatcher and the temporary administrator self-test.
 */
export async function deliverPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  config: VapidConfig,
  send: Sender,
  urgency: "high" | "normal" = "normal",
): Promise<Outcome> {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return "gone";
  try {
    await send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      TTL: TTL_SECONDS,
      timeout: SEND_TIMEOUT_MS,
      urgency,
    });
    return "sent";
  } catch (error) {
    return classifyPushError(error);
  }
}

export const defaultSender: Sender = (s, p, o) => webpush.sendNotification(s, p, o);

/** 404/410 from the push service mean the subscription no longer exists. */
export function classifyPushError(error: unknown): Outcome {
  const status = (error as { statusCode?: number })?.statusCode;
  return status === 404 || status === 410 ? "gone" : "failed";
}

export async function dispatchPendingPushes(deps: { send?: Sender; config?: VapidConfig | null } = {}): Promise<DispatchSummary> {
  const config = deps.config === undefined ? vapidConfig() : deps.config;
  const summary: DispatchSummary = { status: "done", claimed: 0, sent: 0, gone: 0, failed: 0 };
  if (!config) return { ...summary, status: "not_configured" }; // nothing is claimed while push is off
  const send: Sender = deps.send ?? defaultSender;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_push_batch", { p_window_minutes: DISPATCH_WINDOW_MINUTES, p_limit: BATCH_LIMIT });
  if (error) {
    console.warn("push dispatch: claim failed", { code: error.code });
    return { ...summary, status: "error" };
  }
  const rows = (data ?? []) as ClaimRow[];
  summary.claimed = new Set(rows.map((r) => r.notification_id)).size;
  if (rows.length === 0) return summary;

  const results: { notification_id: string; subscription_id: string; outcome: Outcome }[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((row) =>
      deliverPush(row, JSON.stringify(buildPushPayload({ notificationId: row.notification_id, type: row.type, importance: row.importance, link: row.link, unread: row.unread })), config, send,
        row.importance === "high" ? "high" : "normal"),
    ));
    settled.forEach((s, index) => {
      const row = chunk[index];
      const outcome: Outcome = s.status === "fulfilled" ? s.value : classifyPushError(s.reason);
      summary[outcome] += 1;
      results.push({ notification_id: row.notification_id, subscription_id: row.subscription_id, outcome });
    });
  }

  const { error: recordError } = await admin.rpc("record_push_results", { p_results: results });
  if (recordError) console.warn("push dispatch: recording results failed", { code: recordError.code });
  // Counts only: never endpoints, keys, payloads or user identifiers.
  console.info("push dispatch", { claimed: summary.claimed, sent: summary.sent, gone: summary.gone, failed: summary.failed });
  return summary;
}
