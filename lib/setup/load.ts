import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SETTINGS_COLUMNS } from "@/lib/data/settings";
import { computeSetupProgress, isUsableLink, type SetupSnapshot } from "@/lib/setup/progress";

/** Read the persisted state the setup steps depend on (caller's RLS applies). */
export async function loadSetupSnapshot(supabase: SupabaseClient): Promise<SetupSnapshot> {
  const [settings, categories, departments, users, links] = await Promise.all([
    supabase.from("church_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle(),
    supabase.from("categories").select("type").eq("is_active", true),
    supabase.from("departments").select("id, department_subcategories(is_active)").eq("is_active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("external_form_tokens").select("is_active, revoked_at, expires_at, max_submissions, submission_count"),
  ]);
  for (const [name, r] of Object.entries({ settings, categories, departments, users, links })) {
    if (r.error) console.error("Setup progress: query failed", { query: name, code: r.error.code, message: r.error.message });
  }
  const types = ((categories.data ?? []) as { type: string }[]).map((c) => c.type);
  return {
    settings: (settings.data as Record<string, unknown> | null) ?? null,
    activeCategories: {
      attendance: types.filter((t) => t === "attendance").length,
      finance: types.filter((t) => t === "finance").length,
      requisition: types.filter((t) => t === "requisition").length,
    },
    departmentsReady: ((departments.data ?? []) as { department_subcategories: { is_active: boolean }[] | null }[])
      .filter((d) => (d.department_subcategories ?? []).some((s) => s.is_active)).length,
    activeUsers: users.count ?? 0,
    usableLinks: ((links.data ?? []) as Parameters<typeof isUsableLink>[0][]).filter((l) => isUsableLink(l)).length,
  };
}

export async function loadSetupProgress(supabase: SupabaseClient) {
  return computeSetupProgress(await loadSetupSnapshot(supabase));
}
