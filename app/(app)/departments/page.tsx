import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DepartmentManager } from "./department-manager";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requirePagePermission("departments.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: departments }, { data: subs }] = await Promise.all([
    supabase.from("departments").select("id, name, is_active, sort_order").order("sort_order").order("name"),
    supabase.from("department_subcategories").select("id, department_id, name, is_active, sort_order").order("sort_order").order("name"),
  ]);
  type Sub = { id: string; department_id: string; name: string; is_active: boolean };
  const items = ((departments ?? []) as { id: string; name: string; is_active: boolean }[]).map((d) => ({
    id: d.id,
    name: d.name,
    isActive: d.is_active,
    children: ((subs ?? []) as Sub[]).filter((s) => s.department_id === d.id).map((s) => ({ id: s.id, name: s.name, isActive: s.is_active })),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Departments"
        description="Departments and their subcategories appear on the requisition form. Choosing a department shows only its own active subcategories."
      />
      <DepartmentManager items={items} />
    </>
  );
}
