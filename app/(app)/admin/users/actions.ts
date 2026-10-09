"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { publicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isEmailConfirmed } from "@/lib/user-state";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  full_name: z.string().trim().min(2, "Enter the person's name").max(120),
  role_ids: z.array(z.uuid()).min(1, "Choose at least one role"),
  delivery: z.enum(["email", "link"]),
});

function fail(e: unknown) {
  if (e instanceof z.ZodError) return { ok: false as const, error: e.issues[0]?.message ?? "Invalid input" };
  return toActionError(e);
}

/**
 * Invite an internal user. The Supabase Auth admin API (service role, server
 * only) creates the account; roles are then granted with the inviter's own
 * session so the audit log records who granted them.
 */
export async function inviteUser(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ link?: string }>> {
  try {
    await assertPermission("users.manage");
    const v = inviteSchema.parse(input);
    const admin = createSupabaseAdminClient();
    const redirectTo = invitationRedirect();
    let userId: string | undefined;
    let link: string | undefined;
    if (v.delivery === "email") {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { redirectTo, data: { full_name: v.full_name } });
      if (error) throw new ActionError(error.message.includes("already") ? "A user with that email already exists." : `Could not send the invitation: ${error.message}`);
      userId = data.user?.id;
    } else {
      const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: v.email, options: { redirectTo, data: { full_name: v.full_name } } });
      if (error) throw new ActionError(error.message.includes("already") ? "A user with that email already exists." : `Could not create the invitation: ${error.message}`);
      userId = data.user?.id;
      link = data.properties?.action_link;
    }
    if (!userId) throw new ActionError("The invitation was created but the user id was not returned.");
    const supabase = await createSupabaseServerClient();
    await supabase.from("profiles").update({ full_name: v.full_name }).eq("id", userId);
    const { error: roleError } = await supabase.from("user_roles").insert(v.role_ids.map((role_id) => ({ user_id: userId, role_id })));
    if (roleError) throw new ActionError(friendlyDbError(roleError));
    revalidatePath("/admin/users");
    return { ok: true, data: { link }, message: v.delivery === "email" ? `Team member invited successfully. An invitation was emailed to ${v.email}.` : "Team member invited successfully. Send them this invitation link privately — it can only be used once." };
  } catch (e) {
    return fail(e);
  }
}

const ALREADY_ACTIVATED = "This user has already activated their account. Use password reset instead.";
const REISSUE_FAILED = "Unable to create a new invitation.";
const RECOVERY_FAILED = "Unable to create a recovery link.";
const RATE_LIMITED = "An email was sent to this person very recently. Please wait a minute and try again.";

/** Where every invitation and recovery link lands: the callback signs them in, then they choose a password. */
function invitationRedirect() {
  return `${publicEnv().appUrl}/auth/callback?next=/auth/update-password`;
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ProviderError = { code?: string; status?: number } | null;

function providerFailure(error: ProviderError, context: string, fallback: string): never {
  if (error?.code === "over_email_send_rate_limit" || error?.status === 429) throw new ActionError(RATE_LIMITED);
  console.error(context, { code: error?.code, status: error?.status });
  throw new ActionError(fallback);
}

/** Supabase re-invites the same unconfirmed user: same id, new token, earlier link stops working. */
async function issueInvitation(admin: AdminClient, uid: string, email: string, how: "email" | "link") {
  const redirectTo = invitationRedirect();
  const { data, error } = how === "email"
    ? await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    : await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (error) {
    // Confirmed since we looked: the caller switches to a recovery link.
    if (error.code === "email_exists") return { confirmed: true as const };
    providerFailure(error, "Invitation re-issue failed", REISSUE_FAILED);
  }
  // Must be the same account: never a new auth user.
  if (data.user?.id !== uid) throw new ActionError(REISSUE_FAILED);
  const link = how === "link" ? (data as { properties?: { action_link?: string } }).properties?.action_link : undefined;
  if (how === "link" && !link) throw new ActionError(REISSUE_FAILED);
  return { confirmed: false as const, link };
}

/**
 * Password recovery for an existing user; Supabase never creates a user here.
 * The admin client uses the implicit flow, so the link works on any device
 * (unlike the PKCE Forgot-password flow, which needs the requesting browser).
 */
async function issueRecovery(admin: AdminClient, uid: string, email: string, how: "email" | "link") {
  const redirectTo = invitationRedirect();
  if (how === "email") {
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) providerFailure(error, "Recovery email failed", RECOVERY_FAILED);
    return { link: undefined };
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (error) providerFailure(error, "Recovery link failed", RECOVERY_FAILED);
  if (data.user?.id !== uid) throw new ActionError(RECOVERY_FAILED);
  const link = (data as { properties?: { action_link?: string } }).properties?.action_link;
  if (!link) throw new ActionError(RECOVERY_FAILED);
  return { link };
}

export type AccountSetupResult = { link?: string; channel: "invite" | "recovery"; auditRecorded: boolean };

/**
 * Send a new setup link to someone whose account setup is not complete
 * (profiles.account_setup_completed_at is null). The same auth user, profile,
 * roles and audit history are kept; no account is ever created.
 *
 *  - Email not yet confirmed by Supabase → an invitation (email, or a link).
 *  - Already confirmed (the invitation link was opened, but no password was
 *    chosen) → Supabase refuses re-invitations, so a password recovery
 *    (email, or a link) to the same destination instead.
 *
 * A link is returned once for the manager to send privately; it is never
 * stored or logged. Refused for users who completed setup (Forgot password)
 * and for deactivated users (reactivate first).
 */
export async function sendAccountSetup(userId: string, delivery: "email" | "link"): Promise<ActionResult<AccountSetupResult>> {
  try {
    await assertPermission("users.manage");
    const uid = z.uuid().parse(userId);
    const how = z.enum(["email", "link"]).parse(delivery);
    const supabase = await createSupabaseServerClient();
    const { data: profile } = await supabase.from("profiles").select("id, is_active, account_setup_completed_at").eq("id", uid).maybeSingle();
    if (!profile) throw new ActionError("User not found.");
    const p = profile as { is_active: boolean; account_setup_completed_at: string | null };
    if (!p.is_active) throw new ActionError("Reactivate this user before sending a new invitation.");
    if (p.account_setup_completed_at) throw new ActionError(ALREADY_ACTIVATED);

    const admin = createSupabaseAdminClient();
    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(uid);
    if (lookupError || !found.user?.email) {
      console.error("Account setup lookup failed", { code: lookupError?.code, status: lookupError?.status });
      throw new ActionError(REISSUE_FAILED);
    }
    const email = found.user.email;

    let channel: "invite" | "recovery" = isEmailConfirmed(found.user) ? "recovery" : "invite";
    let link: string | undefined;
    if (channel === "invite") {
      const invited = await issueInvitation(admin, uid, email, how);
      if (invited.confirmed) channel = "recovery";
      else link = invited.link;
    }
    if (channel === "recovery") link = (await issueRecovery(admin, uid, email, how)).link;

    // Who sent it and how; never the link or token. The link/email has already
    // gone out and is not rolled back if this fails — the manager is told.
    const { error: auditError } = await supabase.rpc(channel === "invite" ? "log_invitation_reissued" : "log_account_recovery_issued", { p_user_id: uid, p_delivery: how });
    const auditRecorded = !auditError;
    if (auditError) console.error("Account setup audit failed", { channel, delivery: how, code: auditError.code });

    revalidatePath("/admin/users");
    const done = channel === "invite"
      ? (how === "email" ? "Invitation sent" : "New invitation link created")
      : (how === "email" ? "Recovery email sent" : "Recovery link created");
    return {
      ok: true,
      data: { link, channel, auditRecorded },
      message: auditRecorded ? `${done}.` : `${done}, but the audit record could not be written. Please contact an administrator.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserRole(userId: string, roleId: string, granted: boolean): Promise<ActionResult> {
  try {
    const me = await assertPermission("users.manage");
    const supabase = await createSupabaseServerClient();
    const uid = z.uuid().parse(userId);
    const rid = z.uuid().parse(roleId);
    if (granted) {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role_id: rid, granted_by: me.id });
      if (error && error.code !== "23505") throw new ActionError(friendlyDbError(error));
    } else {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role_id", rid);
      if (error) throw new ActionError(error.message.includes("last active administrator") ? "The last active administrator cannot be removed." : friendlyDbError(error));
    }
    revalidatePath("/admin/users");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  try {
    const me = await assertPermission("users.manage");
    const uid = z.uuid().parse(userId);
    if (uid === me.id && !active) throw new ActionError("You cannot deactivate your own account.");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", uid);
    if (error) throw new ActionError(error.message.includes("last active administrator") ? "The last active administrator cannot be deactivated." : friendlyDbError(error));
    if (!active) {
      // End their sessions immediately (server-only admin API).
      await createSupabaseAdminClient().auth.admin.signOut(uid).catch(() => undefined);
    }
    revalidatePath("/admin/users");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
