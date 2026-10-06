import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FormLinks } from "./form-links";

export const metadata = { title: "Requisition links" };

export default async function FormLinksPage() {
  await requirePagePermission("form_links.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: links }, { data: departments }] = await Promise.all([
    supabase.from("external_form_tokens").select("id, label, token_hint, expires_at, max_submissions, submission_count, is_active, revoked_at, last_used_at, created_at, departments(name)").order("created_at", { ascending: false }),
    supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  type Raw = { departments: { name: string } | null; expires_at: string | null } & Record<string, unknown>;
  const now = new Date();
  return (
    <>
      <PageHeader eyebrow="Administration" title="Requisition links" description="Department and ministry leads do not get accounts. They use a secure link that can only submit requests — never view finances, other requests or anything internal." />
      <FormLinks links={((links ?? []) as unknown as Raw[]).map((l) => ({ ...(l as object), department: l.departments?.name ?? null, expired: Boolean(l.expires_at && new Date(l.expires_at) < now) }) as never)} departments={(departments ?? []) as never} />
    </>
  );
}
