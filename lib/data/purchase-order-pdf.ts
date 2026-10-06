import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAddress, SETTINGS_COLUMNS, type ChurchSettings } from "@/lib/data/settings";
import { dateInTimezone, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { renderPurchaseOrderPdf, type PurchaseOrderPdfData } from "@/lib/pdf/purchase-order";

function qty(q: string) {
  return String(q).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Build and render the PDF for a Purchase Order using the caller's (RLS-scoped) client. */
export async function buildPurchaseOrderPdf(supabase: SupabaseClient, purchaseOrderId: string): Promise<{ pdf: Buffer; poNumber: string; requisitionId: string }> {
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*), requisitions(*, departments(name), department_subcategories(name), request_types(name), cost_centers(code, name), categories(name))")
    .eq("id", purchaseOrderId)
    .single();
  if (error || !po) throw new Error("Purchase Order not found");
  const { data: settingsRow } = await supabase.from("church_settings").select(SETTINGS_COLUMNS).eq("id", 1).single();
  const settings = settingsRow as ChurchSettings;
  const { data: people } = await supabase.from("profiles").select("id, full_name, email");
  const names = new Map(((people ?? []) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email]));

  const req = po.requisitions as Record<string, unknown> & {
    requisition_number: string; requester_name: string; requester_email: string; requester_phone: string; needed_by: string;
    reviewed_by: string | null; reviewed_at: string | null; is_demo: boolean;
    departments: { name: string }; department_subcategories: { name: string }; request_types: { name: string };
    cost_centers: { code: string; name: string } | null; categories: { name: string } | null;
  };
  const { data: reqItems } = await supabase.from("requisition_items").select("id, specifications, color, size, vendor_name").eq("requisition_id", po.requisition_id);
  const itemInfo = new Map(((reqItems ?? []) as { id: string; specifications: string | null; color: string | null; size: string | null; vendor_name: string | null }[]).map((i) => [i.id, i]));
  const currency = settings.currency_code;
  const tz = settings.timezone;

  const data: PurchaseOrderPdfData = {
    poNumber: po.po_number,
    requisitionNumber: req.requisition_number,
    issueDate: formatDate(dateInTimezone(po.issued_at, tz), "medium"),
    church: { name: settings.church_name, lines: [...formatAddress(settings), settings.phone, settings.email].filter((v): v is string => Boolean(v)) },
    vendor: { name: po.vendor_name, contact: po.vendor_contact, email: po.vendor_email, phone: po.vendor_phone, address: po.vendor_address, url: po.vendor_url },
    department: req.departments.name,
    subcategory: req.department_subcategories.name,
    requestType: req.request_types.name,
    requester: { name: req.requester_name, email: req.requester_email, phone: req.requester_phone },
    neededBy: formatDate(req.needed_by, "medium"),
    costCenter: req.cost_centers ? `${req.cost_centers.code} — ${req.cost_centers.name}` : null,
    expenseCategory: req.categories?.name ?? null,
    items: [...(po.purchase_order_items as { requisition_item_id: string; line_number: number; description: string; quantity: string; unit_price: string; line_total: string }[])]
      .sort((a, b) => a.line_number - b.line_number)
      .map((i) => {
        const info = itemInfo.get(i.requisition_item_id);
        const detail = [info?.specifications, info?.color ? `Color: ${info.color}` : null, info?.size ? `Size: ${info.size}` : null, !po.vendor_name && info?.vendor_name ? `Vendor: ${info.vendor_name}` : null]
          .filter(Boolean)
          .join(" · ");
        return { line: i.line_number, description: i.description, detail: detail || null, quantity: qty(i.quantity), unitPrice: formatMoney(i.unit_price, currency), lineTotal: formatMoney(i.line_total, currency) };
      }),
    total: formatMoney(po.total, currency),
    approval: {
      approvedBy: req.reviewed_by ? names.get(req.reviewed_by) ?? null : null,
      approvedOn: req.reviewed_at ? formatDate(dateInTimezone(req.reviewed_at, tz), "medium") : null,
      issuedBy: po.issued_by ? names.get(po.issued_by) ?? null : null,
    },
    notes: po.notes,
    instructions: settings.po_instructions,
    footer: settings.po_footer,
    isDemo: Boolean(po.is_demo),
  };
  return { pdf: await renderPurchaseOrderPdf(data), poNumber: po.po_number, requisitionId: po.requisition_id };
}
