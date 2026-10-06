import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withDecimals } from "@/lib/data/decimal";
import type { RequisitionStatus } from "@/lib/workflow/status";
import type { WorkflowKind } from "@/lib/workflow/request-types";
import type { Priority } from "@/lib/priority";

export interface RequisitionItem {
  id: string;
  line_number: number;
  description: string;
  specifications: string | null;
  color: string | null;
  size: string | null;
  quantity: string;
  estimated_unit_price: string;
  estimated_total: string;
  vendor_name: string | null;
  vendor_url: string | null;
  notes: string | null;
  review_status: "pending" | "approved" | "held" | "rejected";
  approved_quantity: string | null;
  approved_unit_price: string | null;
  approved_total: string;
  review_comment: string | null;
  po_quantity: string;
  ordered_quantity: string;
  purchased_quantity: string;
  actual_total: string;
  cancelled_quantity: string;
  cancel_reason: string | null;
  priority: Priority;
  essential_justification: string | null;
}

export interface RequisitionDetail {
  id: string;
  requisition_number: string;
  status: RequisitionStatus;
  review_outcome: RequisitionStatus | null;
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  department_head_name: string;
  submitted_at: string;
  needed_by: string;
  budget_status: "yes" | "no" | "unsure";
  budget_explanation: string | null;
  justification: string;
  certification_name: string;
  certified_at: string;
  actual_purchase_amount: string | null;
  purchase_vendor: string | null;
  purchase_date: string | null;
  estimated_total: string;
  approved_total: string;
  actual_total: string;
  disbursed_total: string;
  assigned_reviewer_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  closed_at: string | null;
  is_demo: boolean;
  cost_center_id: string | null;
  expense_category_id: string | null;
  department: { id: string; name: string };
  subcategory: { id: string; name: string };
  requestType: {
    id: string;
    name: string;
    workflow: WorkflowKind;
    issues_purchase_order: boolean;
    allows_vendor_orders: boolean;
    requires_disbursement: boolean;
    requires_receipt_on_submission: boolean;
    requires_purchase_details: boolean;
  };
  costCenter: { code: string; name: string } | null;
  expenseCategory: { name: string } | null;
  items: RequisitionItem[];
  history: { id: string; from_status: RequisitionStatus | null; to_status: RequisitionStatus; changed_by: string | null; changed_by_label: string | null; comment: string | null; created_at: string }[];
  comments: { id: string; author_id: string | null; body: string; created_at: string }[];
  purchaseOrders: {
    id: string;
    po_number: string;
    status: "issued" | "void";
    vendor_name: string | null;
    total: string;
    issued_at: string;
    issued_by: string | null;
    pdf_path: string | null;
    void_reason: string | null;
    notes: string | null;
    purchase_order_items: { id: string; requisition_item_id: string; line_number: number; description: string; quantity: string; unit_price: string; line_total: string }[];
  }[];
  vendorOrders: {
    id: string;
    vendor_name: string;
    vendor_reference: string | null;
    order_date: string;
    expected_delivery_date: string | null;
    status: "placed" | "cancelled";
    total: string;
    notes: string | null;
    created_by: string | null;
    cancel_reason: string | null;
    purchase_order_id: string | null;
    vendor_order_items: { requisition_item_id: string; quantity: string; unit_price: string; line_total: string }[];
  }[];
  receipts: {
    id: string;
    source: "upload" | "email" | "submission";
    status: "pending" | "reconciled" | "rejected" | "unmatched";
    vendor_name: string | null;
    purchase_date: string | null;
    total_amount: string | null;
    reference: string | null;
    notes: string | null;
    purchase_order_id: string | null;
    submitted_by_label: string | null;
    uploaded_by: string | null;
    created_at: string;
    reconciled_at: string | null;
    reconciled_by: string | null;
    reconciliation_notes: string | null;
    rejected_reason: string | null;
    receipt_files: { id: string; original_filename: string; mime_type: string; size_bytes: number }[];
    receipt_item_allocations: { requisition_item_id: string; quantity: string; actual_amount: string }[];
  }[];
  disbursements: { id: string; amount: string; method: string; paid_on: string; reference: string | null; notes: string | null; recorded_by: string | null; created_at: string }[];
  audit: { id: string; occurred_at: string; actor_id: string | null; actor_label: string | null; action: string; metadata: Record<string, unknown> }[];
  notifications: { id: string; channel: string; template: string; recipient: string; status: string; error: string | null; created_at: string }[];
  people: Map<string, string>;
}

// Numeric columns (PostgREST returns these as JSON numbers) → decimal strings.
const REQUISITION_DECIMALS = ["estimated_total", "approved_total", "actual_total", "disbursed_total"] as const;
const ITEM_DECIMALS = ["quantity", "estimated_unit_price", "estimated_total", "approved_total", "po_quantity", "ordered_quantity", "purchased_quantity", "actual_total", "cancelled_quantity"] as const;
const ITEM_OPTIONAL_DECIMALS = ["approved_quantity", "approved_unit_price"] as const;
const LINE_DECIMALS = ["quantity", "unit_price", "line_total"] as const;

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/**
 * Normalise every quantity/amount in the raw query results to the app's
 * canonical decimal-string shape. Pure — exported for tests.
 */
export function normalizeDetailRows(raw: {
  requisition: Row; items: unknown; purchaseOrders: unknown; vendorOrders: unknown; receipts: unknown; disbursements: unknown;
}) {
  return {
    requisition: withDecimals(raw.requisition, REQUISITION_DECIMALS, ["actual_purchase_amount"]),
    items: rows(raw.items).map((i) => withDecimals(i, ITEM_DECIMALS, ITEM_OPTIONAL_DECIMALS)),
    purchaseOrders: rows(raw.purchaseOrders).map((po): Row => ({
      ...withDecimals(po, ["total"]),
      purchase_order_items: rows(po.purchase_order_items).map((li) => withDecimals(li, LINE_DECIMALS)),
    })),
    vendorOrders: rows(raw.vendorOrders).map((o): Row => ({
      ...withDecimals(o, ["total"]),
      vendor_order_items: rows(o.vendor_order_items).map((li) => withDecimals(li, LINE_DECIMALS)),
    })),
    receipts: rows(raw.receipts).map((r): Row => ({
      ...withDecimals(r, [], ["total_amount"]),
      receipt_item_allocations: rows(r.receipt_item_allocations).map((a) => withDecimals(a, ["quantity", "actual_amount"])),
    })),
    disbursements: rows(raw.disbursements).map((x) => withDecimals(x, ["amount"])),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadRequisitionDetail(id: string): Promise<RequisitionDetail | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: req } = await supabase
    .from("requisitions")
    .select(
      `*, departments(id, name), department_subcategories(id, name),
       request_types(id, name, workflow, issues_purchase_order, allows_vendor_orders, requires_disbursement, requires_receipt_on_submission, requires_purchase_details),
       cost_centers(code, name), categories(name)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!req) return null;

  const [items, history, comments, pos, orders, receipts, disbursements, audit, notifications, people] = await Promise.all([
    supabase.from("requisition_items").select("*").eq("requisition_id", id).order("line_number"),
    supabase.from("requisition_status_history").select("*").eq("requisition_id", id).order("created_at"),
    supabase.from("requisition_comments").select("id, author_id, body, created_at").eq("requisition_id", id).order("created_at"),
    supabase.from("purchase_orders").select("*, purchase_order_items(*)").eq("requisition_id", id).order("issued_at"),
    supabase.from("vendor_orders").select("*, vendor_order_items(requisition_item_id, quantity, unit_price, line_total)").eq("requisition_id", id).order("order_date"),
    supabase
      .from("receipts")
      .select("*, receipt_files(id, original_filename, mime_type, size_bytes), receipt_item_allocations(requisition_item_id, quantity, actual_amount)")
      .eq("requisition_id", id)
      .order("created_at"),
    supabase.from("disbursements").select("*").eq("requisition_id", id).order("paid_on"),
    supabase.from("audit_logs").select("id, occurred_at, actor_id, actor_label, action, metadata").eq("requisition_id", id).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("notifications").select("id, channel, template, recipient, status, error, created_at").eq("requisition_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const n = normalizeDetailRows({
    requisition: req as Row, items: items.data, purchaseOrders: pos.data, vendorOrders: orders.data, receipts: receipts.data, disbursements: disbursements.data,
  });
  const r = n.requisition as Record<string, unknown> & {
    departments: RequisitionDetail["department"];
    department_subcategories: RequisitionDetail["subcategory"];
    request_types: RequisitionDetail["requestType"];
    cost_centers: RequisitionDetail["costCenter"];
    categories: RequisitionDetail["expenseCategory"];
  };
  return {
    ...(r as unknown as RequisitionDetail),
    department: r.departments,
    subcategory: r.department_subcategories,
    requestType: r.request_types,
    costCenter: r.cost_centers,
    expenseCategory: r.categories,
    items: n.items as unknown as RequisitionItem[],
    history: (history.data ?? []) as RequisitionDetail["history"],
    comments: (comments.data ?? []) as RequisitionDetail["comments"],
    purchaseOrders: (n.purchaseOrders as unknown as RequisitionDetail["purchaseOrders"]).map((po) => ({
      ...po,
      purchase_order_items: [...po.purchase_order_items].sort((a, b) => a.line_number - b.line_number),
    })),
    vendorOrders: n.vendorOrders as unknown as RequisitionDetail["vendorOrders"],
    receipts: n.receipts as unknown as RequisitionDetail["receipts"],
    disbursements: n.disbursements as unknown as RequisitionDetail["disbursements"],
    audit: (audit.data ?? []) as RequisitionDetail["audit"],
    notifications: (notifications.data ?? []) as RequisitionDetail["notifications"],
    people: new Map(((people.data ?? []) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email])),
  };
}

/** Users who can review requisitions (for assignment). */
export async function listReviewers(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data: rp }, { data: roles }, { data: ur }, { data: profiles }] = await Promise.all([
    supabase.from("role_permissions").select("role_id").eq("permission_key", "requisitions.review"),
    supabase.from("roles").select("id, key"),
    supabase.from("user_roles").select("user_id, role_id"),
    supabase.from("profiles").select("id, full_name, email, is_active"),
  ]);
  const roleIds = new Set<string>((rp ?? []).map((r) => r.role_id as string));
  for (const role of (roles ?? []) as { id: string; key: string }[]) if (role.key === "administrator") roleIds.add(role.id);
  const userIds = new Set(((ur ?? []) as { user_id: string; role_id: string }[]).filter((u) => roleIds.has(u.role_id)).map((u) => u.user_id));
  return ((profiles ?? []) as { id: string; full_name: string; email: string; is_active: boolean }[])
    .filter((p) => p.is_active && userIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.full_name || p.email }));
}
