import "server-only";

/**
 * TEMPORARY — core of the administrator email delivery self-test
 * (app/(app)/admin/settings/email-test-actions.ts). Remove together with
 * sendDeliverySelfTestEmail in lib/notify.ts once the real Resend delivery
 * webhook has been verified (see docs/NOTIFICATIONS.md).
 */

import { ActionError } from "@/lib/action-result";
import { describeEmailStatus, type DeliveryStatus } from "@/lib/email/delivery-events";
import { DELIVERY_SELF_TEST, sendDeliverySelfTestEmail } from "@/lib/notify";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SelfTestUser {
  id: string;
  email: string;
  roles: readonly string[];
}

export function assertAdministrator(user: SelfTestUser | null): asserts user is SelfTestUser {
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  if (!user.roles.includes("administrator")) throw new ActionError("Only administrators can send a test email.");
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Sends ONE fixed test email to the administrator's own profile email (from
 * the verified session, never from the browser). Creates one `notifications`
 * row and nothing else: no requisition, inbox, push, audit or workflow change.
 */
export async function runEmailSelfTest(user: SelfTestUser): Promise<void> {
  if (!isAdminClientConfigured()) throw new ActionError("Email is not set up.");
  const recipient = user.email.trim().toLowerCase();
  if (!EMAIL.test(recipient)) throw new ActionError("Your account has no valid email address.");

  const admin = createSupabaseAdminClient();
  // Accidental repeats: at most one test per 10 minutes and three per day per administrator.
  for (const [bucket, max, seconds] of [[`email-self-test:10min:${user.id}`, 1, 600], [`email-self-test:day:${user.id}`, 3, 86_400]] as const) {
    const { data: allowed } = await admin.rpc("consume_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: seconds });
    if (allowed !== true) throw new ActionError("A test email was sent recently. Please wait 10 minutes before sending another.");
  }

  // Same key within a minute = Resend collapses a double submission into one email.
  const { result, logged } = await sendDeliverySelfTestEmail(recipient, `delivery-self-test-${user.id}-${Math.floor(Date.now() / 60_000)}`);
  console.info("email self-test", { user: user.id, result: result.status, logged, at: new Date().toISOString() });
  if (result.status === "skipped") throw new ActionError("Email is not set up.");
  if (result.status === "failed") throw new ActionError("Resend did not accept the test email.");
  if (!logged) throw new ActionError("The test email was sent but could not be recorded.");
}

export interface SelfTestStatus {
  sentAt: string;
  app: string;
  provider: string | null;
  tone: "positive" | "neutral" | "attention" | "negative";
  providerAt: string | null;
  events: { type: DeliveryStatus; at: string }[];
}

/** The caller's latest test email: status labels and times only (no address or provider id). */
export async function latestEmailSelfTest(user: SelfTestUser): Promise<SelfTestStatus | null> {
  const supabase = await createSupabaseServerClient(); // row-level security applies
  const { data, error } = await supabase
    .from("notifications")
    .select("channel, status, created_at, delivery_status, delivery_status_at, notification_events(event_type, occurred_at)")
    .eq("template", DELIVERY_SELF_TEST.template)
    .eq("recipient", user.email.trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ActionError("The test email status could not be loaded.");
  if (!data) return null;
  const row = data as unknown as {
    channel: string; status: string; created_at: string; delivery_status: DeliveryStatus | null; delivery_status_at: string | null;
    notification_events: { event_type: DeliveryStatus; occurred_at: string }[] | null;
  };
  const s = describeEmailStatus(row);
  return {
    sentAt: row.created_at,
    app: s.app,
    provider: s.provider,
    tone: s.tone,
    providerAt: row.delivery_status_at,
    events: [...(row.notification_events ?? [])].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((e) => ({ type: e.event_type, at: e.occurred_at })),
  };
}
