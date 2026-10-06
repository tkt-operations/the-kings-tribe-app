"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { moveInScope, nextSortOrder } from "@/lib/config-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const nameSchema = z.string().trim().min(1, "Name is required").max(80, "Keep names under 80 characters");

type Kind = "department" | "subcategory";
const TABLE: Record<Kind, string> = { department: "departments", subcategory: "department_subcategories" };

async function kindOf(id: string): Promise<Kind> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("departments").select("id").eq("id", id).maybeSingle();
  return data ? "department" : "subcategory";
}

function finish(): ActionResult {
  revalidatePath("/departments");
  return { ok: true, data: undefined };
}

function fail(e: unknown) {
  if (e instanceof z.ZodError) return { ok: false as const, error: e.issues[0]?.message ?? "Invalid input" };
  return toActionError(e);
}

export async function createDepartmentItem(name: string, parentId: string | null): Promise<ActionResult> {
  try {
    await assertPermission("departments.manage");
    const n = nameSchema.parse(name);
    const supabase = await createSupabaseServerClient();
    if (parentId) {
      z.uuid().parse(parentId);
      const sort = await nextSortOrder(supabase, "department_subcategories", { department_id: parentId });
      const { error } = await supabase.from("department_subcategories").insert({ department_id: parentId, name: n, sort_order: sort });
      if (error) throw new ActionError(friendlyDbError(error));
    } else {
      const sort = await nextSortOrder(supabase, "departments", {});
      const { error } = await supabase.from("departments").insert({ name: n, sort_order: sort });
      if (error) throw new ActionError(friendlyDbError(error));
    }
    return finish();
  } catch (e) {
    return fail(e);
  }
}

export async function renameDepartmentItem(id: string, name: string): Promise<ActionResult> {
  try {
    await assertPermission("departments.manage");
    const kind = await kindOf(z.uuid().parse(id));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from(TABLE[kind]).update({ name: nameSchema.parse(name) }).eq("id", id);
    if (error) throw new ActionError(friendlyDbError(error));
    return finish();
  } catch (e) {
    return fail(e);
  }
}

export async function setDepartmentItemActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    await assertPermission("departments.manage");
    const kind = await kindOf(z.uuid().parse(id));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from(TABLE[kind]).update({ is_active: active }).eq("id", id);
    if (error) throw new ActionError(friendlyDbError(error));
    return finish();
  } catch (e) {
    return fail(e);
  }
}

export async function moveDepartmentItem(id: string, direction: "up" | "down"): Promise<ActionResult> {
  try {
    await assertPermission("departments.manage");
    const kind = await kindOf(z.uuid().parse(id));
    const supabase = await createSupabaseServerClient();
    if (kind === "department") {
      await moveInScope(supabase, "departments", id, direction, {});
    } else {
      const { data } = await supabase.from("department_subcategories").select("department_id").eq("id", id).single();
      await moveInScope(supabase, "department_subcategories", id, direction, { department_id: data?.department_id as string });
    }
    return finish();
  } catch (e) {
    return fail(e);
  }
}
