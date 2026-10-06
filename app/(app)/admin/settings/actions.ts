"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, issuesToFieldErrors, toActionError, type ActionResult } from "@/lib/action-result";
import { describeIncomplete } from "@/lib/setup/progress";
import { loadSetupProgress } from "@/lib/setup/load";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ALL_SETTINGS_SECTIONS, sectionColumns, sectionSchema, SETTINGS_SECTIONS, type SettingsSection } from "@/lib/validation/settings";

const GENERIC_DB = "Something went wrong. Please try again.";

function labels(sections: SettingsSection[]) {
  const only = (...s: SettingsSection[]) => sections.length > 0 && sections.every((x) => s.includes(x));
  if (only("church", "money")) return { saved: "Church information saved successfully.", failed: "Church information could not be saved. Please try again." };
  if (only("notifications", "policy")) return { saved: "Notification settings saved successfully.", failed: "Notification settings could not be saved. Please try again." };
  return { saved: "Settings saved successfully.", failed: "Settings could not be saved. Please try again." };
}

/**
 * Save the given settings sections only (the wizard saves one step at a time;
 * Administration → Settings saves all four). Only those columns are written.
 */
export async function saveSettings(
  input: Record<string, unknown>,
  options: { sections?: SettingsSection[]; requireNotificationEmail?: boolean } = {},
): Promise<ActionResult> {
  const sections = (options.sections ?? ALL_SETTINGS_SECTIONS).filter((s): s is SettingsSection => s in SETTINGS_SECTIONS);
  const text = labels(sections);
  try {
    const user = await assertPermission("settings.manage");
    if (sections.length === 0) throw new ActionError("Nothing to save.");
    const parsed = sectionSchema(sections, { requireNotificationEmail: options.requireNotificationEmail }).safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
    }
    const values = Object.fromEntries(sectionColumns(sections).map((c) => [c, (parsed.data as Record<string, unknown>)[c]]));
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("church_settings")
      .update({ ...values, updated_by: user.id })
      .eq("id", 1)
      .select("id");
    if (error) {
      // friendlyDbError logs the details server-side; known causes get a specific message.
      const friendly = friendlyDbError(error);
      throw new ActionError(friendly === GENERIC_DB ? text.failed : friendly);
    }
    if (!data || data.length === 0) {
      console.error("saveSettings: no church_settings row updated", { userId: user.id, sections });
      throw new ActionError(text.failed);
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: text.saved };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: text.failed };
    return toActionError(e);
  }
}

/** Marks setup complete only when every required step is genuinely complete. */
export async function completeSetup(): Promise<ActionResult> {
  try {
    await assertPermission("settings.manage");
    const supabase = await createSupabaseServerClient();
    const progress = await loadSetupProgress(supabase);
    if (!progress.readyToComplete) {
      throw new ActionError(`Setup can't be marked complete yet. Still needed: ${describeIncomplete(progress.incompleteRequired)}`);
    }
    const { data, error } = await supabase
      .from("church_settings")
      .update({ setup_completed_at: new Date().toISOString() })
      .eq("id", 1)
      .select("id");
    if (error) {
      const friendly = friendlyDbError(error);
      throw new ActionError(friendly === GENERIC_DB ? "Setup could not be marked complete. Please try again." : friendly);
    }
    if (!data || data.length === 0) {
      console.error("completeSetup: no church_settings row updated");
      throw new ActionError("Setup could not be marked complete. Please try again.");
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: "Setup completed successfully." };
  } catch (e) {
    return toActionError(e);
  }
}
