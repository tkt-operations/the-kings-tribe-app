"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/action-result";

const TOKEN = /^[0-9a-f]{48}$/;

/** Requester-controlled opt-in/out for one requisition's updates (token from their email). */
export async function updatePreferences(token: string, emailOptIn: boolean, smsOptIn: boolean): Promise<ActionResult> {
  if (!TOKEN.test(token)) return { ok: false, error: "This link is not valid." };
  const parsed = z.object({ e: z.boolean(), s: z.boolean() }).safeParse({ e: emailOptIn, s: smsOptIn });
  if (!parsed.success) return { ok: false, error: "Invalid choice." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("notification_preferences")
    .update({ email_opt_in: parsed.data.e, sms_opt_in: parsed.data.s, sms_consent_at: parsed.data.s ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("manage_token", token)
    .select("requisition_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "This link is not valid." };
  return { ok: true, data: undefined, message: "Your preferences were saved." };
}
