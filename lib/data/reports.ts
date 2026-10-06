import "server-only";

import { byDate, summarizeServices, type ServiceTotalRow } from "@/lib/analytics";
import { addDays } from "@/lib/dates";
import type { RequisitionReportRow } from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function loadServiceData(from: string, to: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("service_category_totals", { p_from: from, p_to: to });
  const summary = summarizeServices((data ?? []) as ServiceTotalRow[]);
  return { ...summary, points: byDate(summary.services) };
}

export async function loadRequisitionRows(from: string, to: string): Promise<RequisitionReportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("requisitions")
    .select("id, requisition_number, submitted_at, status, estimated_total, approved_total, actual_total, departments(name), department_subcategories(name), request_types(name), categories(name)")
    .gte("submitted_at", `${from}T00:00:00Z`)
    .lt("submitted_at", `${addDays(to, 1)}T00:00:00Z`)
    .order("submitted_at")
    .limit(5000);
  type Raw = Omit<RequisitionReportRow, "department" | "subcategory" | "request_type" | "expense_category"> & {
    departments: { name: string } | null; department_subcategories: { name: string } | null; request_types: { name: string } | null; categories: { name: string } | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    requisition_number: r.requisition_number,
    submitted_at: r.submitted_at,
    status: r.status,
    estimated_total: String(r.estimated_total),
    approved_total: String(r.approved_total),
    actual_total: String(r.actual_total),
    department: r.departments?.name ?? "—",
    subcategory: r.department_subcategories?.name ?? "—",
    request_type: r.request_types?.name ?? "—",
    expense_category: r.categories?.name ?? null,
  }));
}
