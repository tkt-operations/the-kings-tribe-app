"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { moveInScope, nextSortOrder } from "@/lib/config-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const typeSchema = z.enum(["attendance", "finance", "requisition"]);
const nameSchema = z.string().trim().min(1, "Name is required").max(80, "Keep names under 80 characters");

function done(): ActionResult {
  revalidatePath("/categories");
  revalidatePath("/sunday");
  return { ok: true, data: undefined };
}

export async function createCategory(type: string, name: string, parentId: string | null): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const t = typeSchema.parse(type);
    const n = nameSchema.parse(name);
    if (parentId !== null) z.uuid().parse(parentId);
    if (t === "attendance" && parentId) throw new ActionError("Attendance categories do not have subcategories.");
    const supabase = await createSupabaseServerClient();
    const sort = await nextSortOrder(supabase, "categories", { type: t, parent_id: parentId });
    const { error } = await supabase.from("categories").insert({ type: t, name: n, parent_id: parentId, sort_order: sort });
    if (error) throw new ActionError(friendlyDbError(error));
    return done();
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}

export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("categories").update({ name: nameSchema.parse(name) }).eq("id", z.uuid().parse(id));
    if (error) throw new ActionError(friendlyDbError(error));
    return done();
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}

export async function setCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("categories").update({ is_active: active }).eq("id", z.uuid().parse(id));
    if (error) throw new ActionError(friendlyDbError(error));
    return done();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setCategoryAllowsNegative(id: string, allows: boolean): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("categories").update({ allows_negative: allows }).eq("id", z.uuid().parse(id));
    if (error) throw new ActionError(friendlyDbError(error));
    return done();
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("categories").select("type, parent_id").eq("id", z.uuid().parse(id)).single();
    if (!data) throw new ActionError("Category not found.");
    await moveInScope(supabase, "categories", id, direction, { type: data.type as string, parent_id: (data.parent_id as string | null) ?? null });
    return done();
  } catch (e) {
    return toActionError(e);
  }
}

// ---- Cost centers (Accounting / Budget) ----
const costCenterSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, "Codes use letters, numbers, dot, dash or underscore (max 20)"),
  name: nameSchema,
  department_id: z.uuid().nullable(),
});

export async function saveCostCenter(id: string | null, input: z.infer<typeof costCenterSchema>): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const value = costCenterSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    if (id) {
      const { error } = await supabase.from("cost_centers").update(value).eq("id", z.uuid().parse(id));
      if (error) throw new ActionError(friendlyDbError(error));
    } else {
      const sort = await nextSortOrder(supabase, "cost_centers", {});
      const { error } = await supabase.from("cost_centers").insert({ ...value, sort_order: sort });
      if (error) throw new ActionError(friendlyDbError(error));
    }
    revalidatePath("/categories");
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}

export async function setCostCenterActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    await assertPermission("categories.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("cost_centers").update({ is_active: active }).eq("id", z.uuid().parse(id));
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/categories");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
