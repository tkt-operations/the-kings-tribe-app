import "server-only";

import { byDate, summarizeServices, type ServiceTotalRow } from "@/lib/analytics";
import { addDays } from "@/lib/dates";
import type { RequisitionItemReportRow, RequisitionReportRow } from "@/lib/reports";
import type { Priority } from "@/lib/priority";
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
    .select("id, requisition_number, submitted_at, status, estimated_total, approved_total, actual_total, departments(name), department_subcategories(name), request_types(name), categories(name), highest_item_priority, essential_item_count")
    .gte("submitted_at", `${from}T00:00:00Z`)
    .lt("submitted_at", `${addDays(to, 1)}T00:00:00Z`)
    .order("submitted_at")
    .limit(5000);
  type Raw = Omit<RequisitionReportRow, "department" | "subcategory" | "request_type" | "expense_category"> & {
    highest_item_priority?: Priority | null; essential_item_count?: number;
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
    highest_item_priority: r.highest_item_priority ?? null,
    essential_item_count: r.essential_item_count ?? 0,
  }));
}

/** Line items of requisitions submitted in the range (RLS-scoped). */
export async function loadRequisitionItemRows(from: string, to: string): Promise<RequisitionItemReportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("requisition_items")
    .select(
      "requisition_id, line_number, description, priority, essential_justification, quantity, estimated_total, review_status, approved_total, actual_total, requisitions!inner(requisition_number, submitted_at, status, departments(name))",
    )
    .gte("requisitions.submitted_at", `${from}T00:00:00Z`)
    .lt("requisitions.submitted_at", `${addDays(to, 1)}T00:00:00Z`)
    .limit(20000);
  type Raw = Omit<RequisitionItemReportRow, "requisition_number" | "submitted_at" | "status" | "department"> & {
    requisitions: { requisition_number: string; submitted_at: string; status: string; departments: { name: string } | null } | null;
  };
  return ((data ?? []) as unknown as Raw[])
    .filter((i) => i.requisitions)
    .map((i) => ({
      requisition_id: i.requisition_id,
      requisition_number: i.requisitions!.requisition_number,
      submitted_at: i.requisitions!.submitted_at,
      status: i.requisitions!.status,
      department: i.requisitions!.departments?.name ?? "—",
      line_number: i.line_number,
      description: i.description,
      priority: i.priority as Priority,
      essential_justification: i.essential_justification,
      quantity: String(i.quantity),
      estimated_total: String(i.estimated_total),
      review_status: i.review_status,
      approved_total: String(i.approved_total),
      actual_total: String(i.actual_total),
    }))
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.requisition_number.localeCompare(b.requisition_number) || a.line_number - b.line_number);
}
