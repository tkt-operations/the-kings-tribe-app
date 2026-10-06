"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { settingsSchema } from "@/lib/validation/settings";

export async function saveSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const user = await assertPermission("settings.manage");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
      return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("church_settings").update({ ...parsed.data, updated_by: user.id }).eq("id", 1);
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Settings saved successfully." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function completeSetup(): Promise<ActionResult> {
  try {
    await assertPermission("settings.manage");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("church_settings").update({ setup_completed_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Setup completed successfully." };
  } catch (e) {
    return toActionError(e);
  }
}
