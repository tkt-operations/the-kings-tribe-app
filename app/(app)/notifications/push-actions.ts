"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ActionError, toActionError, type ActionResult } from "@/lib/action-result";
import { AUTH_PATTERN, isAllowedPushEndpoint, P256DH_PATTERN } from "@/lib/push/endpoints";
import { vapidConfig } from "@/lib/push/vapid";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phone-notification settings for the signed-in internal user. Every database
 * call acts only for auth.uid(); endpoints and keys are never returned.
 */

export interface PushDevice {
  id: string;
  label: string | null;
  created_at: string;
  last_success_at: string | null;
  this_device: boolean;
}
export interface PushStatus {
  configured: boolean;
  thisDevice: boolean;
  pushLevel: "important" | "actionable";
  devices: PushDevice[];
}

const subscriptionSchema = z.object({
  endpoint: z.string().refine(isAllowedPushEndpoint, "This browser's push service is not supported."),
  keys: z.object({ p256dh: z.string().regex(P256DH_PATTERN), auth: z.string().regex(AUTH_PATTERN) }),
  label: z.string().trim().max(80).optional(),
});
const endpointSchema = z.string().refine(isAllowedPushEndpoint);

async function session() {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  return user;
}

export async function getPushStatus(endpoint: string | null): Promise<ActionResult<PushStatus>> {
  try {
    await session();
    const supabase = await createSupabaseServerClient();
    const safeEndpoint = endpoint && endpointSchema.safeParse(endpoint).success ? endpoint : null;
    const { data, error } = await supabase.rpc("my_push_status", { p_endpoint: safeEndpoint });
    if (error) throw new ActionError("Phone notification settings could not be loaded.");
    const d = data as { this_device: boolean; push_level: PushStatus["pushLevel"]; devices: PushDevice[] };
    return { ok: true, data: { configured: vapidConfig() !== null, thisDevice: Boolean(d.this_device), pushLevel: d.push_level, devices: d.devices ?? [] } };
  } catch (e) {
    return toActionError(e);
  }
}

/** Called only after the user tapped "Enable phone notifications" and the browser granted permission. */
export async function savePushSubscription(input: unknown): Promise<ActionResult<{ transferred: boolean }>> {
  try {
    await session();
    if (!vapidConfig()) throw new ActionError("Phone notifications are not set up yet.");
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) throw new ActionError("This browser's push subscription could not be saved.");
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_push_subscription", {
      p_endpoint: parsed.data.endpoint,
      p_p256dh: parsed.data.keys.p256dh,
      p_auth: parsed.data.keys.auth,
      p_device_label: parsed.data.label ?? null,
    });
    if (error) throw new ActionError("Phone notifications could not be turned on. Please try again.");
    return { ok: true, data: { transferred: Boolean((data as { transferred?: boolean })?.transferred) }, message: "Phone notifications are on for this device." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Turn push off for this browser (only removes it if it belongs to the caller). */
export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  try {
    await session();
    if (!endpointSchema.safeParse(endpoint).success) throw new ActionError("This device is not registered.");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("delete_my_push_subscription", { p_endpoint: endpoint });
    if (error) throw new ActionError("Phone notifications could not be turned off. Please try again.");
    return { ok: true, data: undefined, message: "Phone notifications are off for this device." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Remove one of the caller's devices from the list (by id; another user's id does nothing). */
export async function removePushDevice(id: string): Promise<ActionResult> {
  try {
    await session();
    if (!z.uuid().safeParse(id).success) throw new ActionError("That device could not be found.");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("delete_my_push_device", { p_id: id });
    if (error) throw new ActionError("The device could not be removed. Please try again.");
    return { ok: true, data: undefined, message: "Device removed." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setPushLevel(level: string): Promise<ActionResult<{ pushLevel: PushStatus["pushLevel"] }>> {
  try {
    await session();
    if (level !== "important" && level !== "actionable") throw new ActionError("Choose a valid option.");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_my_push_level", { p_level: level });
    if (error) throw new ActionError("The setting could not be saved. Please try again.");
    return { ok: true, data: { pushLevel: level }, message: "Phone notification preference saved." };
  } catch (e) {
    return toActionError(e);
  }
}
