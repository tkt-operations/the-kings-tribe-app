import "server-only";

/**
 * TEMPORARY — core of the administrator Web Push self-test
 * (app/(app)/notifications/push-test-actions.ts). Remove together.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action-result";
import { defaultSender, deliverPush, type Outcome, type Sender } from "@/lib/push/dispatch";
import { buildTestPushPayload } from "@/lib/push/payload";
import { vapidConfig, type VapidConfig } from "@/lib/push/vapid";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SelfTestUser {
  id: string;
  roles: readonly string[];
}

export function assertAdministrator(user: SelfTestUser | null): asserts user is SelfTestUser {
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  if (!user.roles.includes("administrator")) throw new ActionError("Only administrators can send a test notification.");
}

export async function runPushSelfTest(
  user: SelfTestUser,
  requisitionId: unknown,
  deps: { send?: Sender; config?: VapidConfig | null } = {},
): Promise<{ devices: number; sent: number }> {
  if (!z.uuid().safeParse(requisitionId).success) throw new ActionError("Choose a requisition.");
  const id = requisitionId as string;
  const config = deps.config === undefined ? vapidConfig() : deps.config;
  if (!config) throw new ActionError("Phone notifications are not set up.");

  // The requisition must exist AND be visible to this administrator (row-level security).
  const supabase = await createSupabaseServerClient();
  const { data: requisition } = await supabase.from("requisitions").select("id").eq("id", id).maybeSingle();
  if (!requisition) throw new ActionError("That requisition could not be found.");

  const admin = createSupabaseAdminClient();
  // Accidental repeats: at most one test per minute and five per hour per administrator.
  for (const [bucket, max, seconds] of [[`push-self-test:min:${user.id}`, 1, 60], [`push-self-test:hour:${user.id}`, 5, 3600]] as const) {
    const { data: allowed } = await admin.rpc("consume_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: seconds });
    if (allowed !== true) throw new ActionError("A test notification was sent recently. Please wait a minute before sending another.");
  }

  // Only the caller's own devices (user id from the verified session, never from the client).
  const { data: subs, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user.id);
  if (error) throw new ActionError("Your devices could not be loaded.");
  const devices = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
  if (devices.length === 0) throw new ActionError("No phone is registered for your account. Turn on phone notifications on your phone first.");

  // Fixed generic payload; only the validated requisition id varies. One send per device, no retries.
  const payload = JSON.stringify(buildTestPushPayload(id, randomUUID()));
  const send = deps.send ?? defaultSender;
  const results: { notification_id: null; subscription_id: string; outcome: Outcome }[] = [];
  for (const sub of devices) results.push({ notification_id: null, subscription_id: sub.id, outcome: await deliverPush(sub, payload, config, send) });
  // Subscription health only (gone -> removed, failures counted, success time). No dispatch, inbox or audit rows.
  await admin.rpc("record_push_results", { p_results: results });

  const sent = results.filter((r) => r.outcome === "sent").length;
  console.info("push self-test", {
    user: user.id, devices: devices.length, sent,
    gone: results.filter((r) => r.outcome === "gone").length, failed: results.filter((r) => r.outcome === "failed").length,
    at: new Date().toISOString(),
  });
  if (sent === 0) throw new ActionError("The push service did not accept the test notification.");
  return { devices: devices.length, sent };
}
