"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { requisitionLinkUrl } from "@/lib/links";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateFormToken, hashToken } from "@/lib/tokens";

const schema = z.object({
  label: z.string().trim().min(2, "Give the link a label, e.g. “Hospitality 2026”").max(120),
  department_id: z.uuid().nullable(),
  expires_in_days: z.number().int().min(0).max(3650),
  max_submissions: z.number().int().min(0).max(100000),
});

type LinkSettings = { label: string; department_id: string | null; expires_at: string | null; max_submissions: number | null };

/** Insert a link row. Only the hash and a 6-character hint are stored; the URL is returned once. */
async function insertLink(createdBy: string, settings: LinkSettings): Promise<string> {
  const token = generateFormToken();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("external_form_tokens").insert({
    ...settings,
    token_hash: hashToken(token),
    token_hint: token.slice(0, 6),
    created_by: createdBy,
  });
  if (error) throw new ActionError(friendlyDbError(error));
  return requisitionLinkUrl(token);
}

export async function createFormLink(input: z.input<typeof schema>): Promise<ActionResult<{ url: string }>> {
  try {
    const me = await assertPermission("form_links.manage");
    const v = schema.parse(input);
    const url = await insertLink(me.id, {
      label: v.label,
      department_id: v.department_id,
      expires_at: v.expires_in_days ? new Date(Date.now() + v.expires_in_days * 86_400_000).toISOString() : null,
      max_submissions: v.max_submissions || null,
    });
    revalidatePath("/admin/form-links");
    return { ok: true, data: { url }, message: "Requisition link created successfully." };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}

/**
 * The full URL of an existing link cannot be recovered (only its hash is
 * stored). "Replace link" issues a new link with the same label, department,
 * expiry and limit, then revokes the old one, and returns the new URL once.
 */
export async function replaceFormLink(id: string): Promise<ActionResult<{ url: string; oldRevoked: boolean }>> {
  try {
    const me = await assertPermission("form_links.manage");
    const supabase = await createSupabaseServerClient();
    const { data: old, error } = await supabase
      .from("external_form_tokens")
      .select("id, label, department_id, expires_at, max_submissions, is_active, revoked_at")
      .eq("id", z.uuid().parse(id))
      .maybeSingle();
    if (error) throw new ActionError(friendlyDbError(error));
    if (!old) throw new ActionError("Requisition link not found.");
    if (!old.is_active || old.revoked_at) throw new ActionError("Only active links can be replaced. Create a new link instead.");
    if (old.expires_at && new Date(old.expires_at as string) <= new Date()) throw new ActionError("This link has expired. Create a new link instead.");

    const url = await insertLink(me.id, {
      label: old.label as string,
      department_id: (old.department_id as string | null) ?? null,
      expires_at: (old.expires_at as string | null) ?? null,
      max_submissions: (old.max_submissions as number | null) ?? null,
    });
    const { error: revokeError } = await supabase
      .from("external_form_tokens")
      .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: me.id })
      .eq("id", old.id as string);
    revalidatePath("/admin/form-links");
    if (revokeError) {
      console.error("replaceFormLink: new link created but old link not revoked", { id: old.id, code: revokeError.code });
      return { ok: true, data: { url, oldRevoked: false }, message: "New link created, but the old link is still active. Revoke it manually." };
    }
    return { ok: true, data: { url, oldRevoked: true }, message: "Requisition link replaced. The old link no longer works." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeFormLink(id: string): Promise<ActionResult> {
  try {
    const me = await assertPermission("form_links.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("external_form_tokens").update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: me.id }).eq("id", z.uuid().parse(id));
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/admin/form-links");
    return { ok: true, data: undefined, message: "Requisition link revoked successfully." };
  } catch (e) {
    return toActionError(e);
  }
}
