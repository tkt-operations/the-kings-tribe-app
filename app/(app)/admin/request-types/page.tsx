import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RequestTypeAdmin, type RequestTypeRow } from "./request-type-admin";

export const metadata = { title: "Request types" };

export default async function RequestTypesPage() {
  await requirePagePermission("request_types.manage");
  const settings = await getChurchSettings();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("request_types").select("*").order("sort_order").order("name");
  return (
    <>
      <PageHeader eyebrow="Administration" title="Request types" description="Each type carries its own required fields, approval path and post-approval actions. New types reuse one of the five workflows." />
      <RequestTypeAdmin types={((data ?? []) as RequestTypeRow[]).map((t) => ({ ...t, max_total: t.max_total === null ? null : String(t.max_total) }))} currency={settings?.currency_code ?? "USD"} />
    </>
  );
}
