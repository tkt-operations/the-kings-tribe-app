"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { isPermission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setRolePermission(roleId: string, permission: string, granted: boolean): Promise<ActionResult> {
  try {
    await assertPermission("users.manage");
    if (!isPermission(permission)) throw new ActionError("Unknown permission.");
    const supabase = await createSupabaseServerClient();
    const { data: role } = await supabase.from("roles").select("key").eq("id", z.uuid().parse(roleId)).single();
    if (!role) throw new ActionError("Role not found.");
    if (role.key === "administrator") throw new ActionError("Administrators always hold every permission.");
    const { error } = granted
      ? await supabase.from("role_permissions").insert({ role_id: roleId, permission_key: permission })
      : await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_key", permission);
    if (error && error.code !== "23505") throw new ActionError(friendlyDbError(error));
    revalidatePath("/admin/roles");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(60),
  description: z.string().trim().max(300).optional().default(""),
});

export async function createRole(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  try {
    await assertPermission("users.manage");
    const v = roleSchema.parse(input);
    const key = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "r_$1").slice(0, 40) || "custom_role";
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("roles").insert({ key, name: v.name, description: v.description || null });
    if (error) throw new ActionError(error.code === "23505" ? "A role with that name already exists." : friendlyDbError(error));
    revalidatePath("/admin/roles");
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}
