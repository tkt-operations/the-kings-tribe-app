"use server";

/**
 * TEMPORARY — administrator Web Push self-test (deep-link verification).
 * Remove this file, lib/push/self-test.ts, buildTestPushPayload and the
 * "Send test notification" control in components/notifications/push-settings.tsx
 * once the Release 2 device tests are complete.
 *
 * Sends ONE fixed, generic alert to the CALLER'S OWN registered devices only,
 * deep-linking to a requisition the caller can already see. Creates no
 * workflow event, inbox notification, email, audit entry or requisition
 * change. The only client input is a requisition id.
 */

import { getSessionUser } from "@/lib/auth";
import { ActionError, toActionError, type ActionResult } from "@/lib/action-result";
import { assertAdministrator, runPushSelfTest } from "@/lib/push/self-test";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TestPushTarget {
  id: string;
  requisition_number: string;
  submitted_at: string;
}

/** Recent requisitions the administrator can see (RLS), for the controlled picker. No personal details. */
export async function listTestPushTargets(): Promise<ActionResult<TestPushTarget[]>> {
  try {
    assertAdministrator(await getSessionUser());
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("requisitions").select("id, requisition_number, submitted_at").order("submitted_at", { ascending: false }).limit(10);
    if (error) throw new ActionError("Requisitions could not be loaded.");
    return { ok: true, data: (data ?? []) as TestPushTarget[] };
  } catch (e) {
    return toActionError(e);
  }
}

export async function sendTestPush(requisitionId: string): Promise<ActionResult<{ devices: number; sent: number }>> {
  try {
    const user = await getSessionUser(); // null for signed-out or deactivated users
    assertAdministrator(user);
    const result = await runPushSelfTest(user, requisitionId);
    return { ok: true, data: result, message: `Test notification sent to ${result.sent} device${result.sent === 1 ? "" : "s"}. Tap it on your phone.` };
  } catch (e) {
    return toActionError(e);
  }
}
