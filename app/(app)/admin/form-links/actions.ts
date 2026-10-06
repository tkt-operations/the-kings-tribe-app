"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateFormToken, hashToken } from "@/lib/tokens";

const schema = z.object({
  label: z.string().trim().min(2, "Give the link a label, e.g. “Hospitality 2026”").max(120),
  department_id: z.uuid().nullable(),
  expires_in_days: z.number().int().min(0).max(3650),
  max_submissions: z.number().int().min(0).max(100000),
});

export async function createFormLink(input: z.input<typeof schema>): Promise<ActionResult<{ url: string }>> {
  try {
    const me = await assertPermission("form_links.manage");
    const v = schema.parse(input);
    const token = generateFormToken();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("external_form_tokens").insert({
      label: v.label,
      token_hash: hashToken(token),
      token_hint: token.slice(0, 6),
      department_id: v.department_id,
      expires_at: v.expires_in_days ? new Date(Date.now() + v.expires_in_days * 86_400_000).toISOString() : null,
      max_submissions: v.max_submissions || null,
      created_by: me.id,
    });
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/admin/form-links");
    return { ok: true, data: { url: `${publicEnv().appUrl}/request/${token}` } };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
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
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
