import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RoleMatrix } from "./role-matrix";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePagePermission("users.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: roles }, { data: permissions }, { data: rp }] = await Promise.all([
    supabase.from("roles").select("id, key, name").order("is_system", { ascending: false }).order("created_at"),
    supabase.from("permissions").select("key, group_name, description").order("group_name").order("key"),
    supabase.from("role_permissions").select("role_id, permission_key"),
  ]);
  const grants: Record<string, string[]> = {};
  for (const g of (rp ?? []) as { role_id: string; permission_key: string }[]) (grants[g.role_id] ??= []).push(g.permission_key);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Roles & permissions" description="Permissions are enforced by the database (Row Level Security), not just hidden in the interface. Administrators always hold every permission." />
      <RoleMatrix roles={(roles ?? []) as never} permissions={(permissions ?? []) as never} grants={grants} />
    </>
  );
}
