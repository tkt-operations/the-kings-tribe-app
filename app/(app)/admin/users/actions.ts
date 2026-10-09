"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { publicEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasActivatedAccount } from "@/lib/user-state";

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

/** Where every invitation lands: the callback exchanges the code, then they choose a password. */
function invitationRedirect() {
  return `${publicEnv().appUrl}/auth/callback?next=/auth/update-password`;
}

/**
 * Re-issue an invitation to someone who has not activated their account yet.
 * Supabase re-invites the existing auth user (same id, new token; the previous
 * token stops working), so the profile, roles and audit history are untouched.
 *
 *  - "email": Supabase emails a fresh invitation.
 *  - "link":  a fresh invitation link is returned once, for the manager to send
 *             privately. It is never stored or logged.
 *
 * Refused for activated users (use password reset) and for deactivated users
 * (reactivate first, so an invitation can never bypass a deactivation).
 */
export async function resendInvitation(userId: string, delivery: "email" | "link"): Promise<ActionResult<{ link?: string }>> {
  try {
    await assertPermission("users.manage");
    const uid = z.uuid().parse(userId);
    const how = z.enum(["email", "link"]).parse(delivery);
    const supabase = await createSupabaseServerClient();
    const { data: profile } = await supabase.from("profiles").select("id, is_active").eq("id", uid).maybeSingle();
    if (!profile) throw new ActionError("User not found.");
    if (!(profile as { is_active: boolean }).is_active) throw new ActionError("Reactivate this user before sending a new invitation.");

    const admin = createSupabaseAdminClient();
    const { data: found, error: lookupError } = await admin.auth.admin.getUserById(uid);
    if (lookupError || !found.user?.email) {
      console.error("Invitation lookup failed", { code: lookupError?.code, status: lookupError?.status });
      throw new ActionError(REISSUE_FAILED);
    }
    if (hasActivatedAccount(found.user)) throw new ActionError(ALREADY_ACTIVATED);

    const redirectTo = invitationRedirect();
    const { data, error } = how === "email"
      ? await admin.auth.admin.inviteUserByEmail(found.user.email, { redirectTo })
      : await admin.auth.admin.generateLink({ type: "invite", email: found.user.email, options: { redirectTo } });
    if (error) {
      // Accepted between loading the page and clicking the button.
      if (error.code === "email_exists") throw new ActionError(ALREADY_ACTIVATED);
      console.error("Invitation re-issue failed", { code: error.code, status: error.status });
      throw new ActionError(REISSUE_FAILED);
    }
    // Must be the same account: never a new auth user.
    if (data.user?.id !== uid) throw new ActionError(REISSUE_FAILED);
    const link = how === "link" ? (data as { properties?: { action_link?: string } }).properties?.action_link : undefined;
    if (how === "link" && !link) throw new ActionError(REISSUE_FAILED);

    // Who re-issued it and how; never the link or token.
    const { error: auditError } = await supabase.rpc("log_invitation_reissued", { p_user_id: uid, p_delivery: how });
    if (auditError) console.error("Invitation audit failed", { code: auditError.code });

    revalidatePath("/admin/users");
    return { ok: true, data: { link }, message: how === "email" ? "Invitation sent." : "New invitation link created." };
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
