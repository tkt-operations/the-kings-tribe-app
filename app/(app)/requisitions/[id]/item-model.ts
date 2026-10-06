import { decimalOrNull, decimalString } from "@/lib/data/decimal";
import type { Priority } from "@/lib/priority";
import type { ItemModel } from "./types";

/** Shape of a requisition_items row as it may arrive from the API (numerics as numbers or strings). */
export interface ItemRow {
  id: string;
  line_number: number;
  description: string;
  quantity: string | number;
  estimated_unit_price: string | number;
  review_status: ItemModel["reviewStatus"];
  approved_quantity: string | number | null;
  approved_unit_price: string | number | null;
  approved_total: string | number;
  po_quantity: string | number;
  ordered_quantity: string | number;
  purchased_quantity: string | number;
  cancelled_quantity: string | number;
  actual_total: string | number;
  review_comment: string | null;
  vendor_name: string | null;
  priority: Priority;
  essential_justification: string | null;
}

/** Client model for the review / PO / order / reconcile dialogs. All quantities and amounts are decimal strings. */
export function toItemModel(i: ItemRow): ItemModel {
  return {
    id: i.id,
    line: i.line_number,
    description: i.description,
    quantity: decimalString(i.quantity),
    estimatedUnitPrice: decimalString(i.estimated_unit_price),
    reviewStatus: i.review_status,
    approvedQuantity: decimalOrNull(i.approved_quantity),
    approvedUnitPrice: decimalOrNull(i.approved_unit_price),
    approvedTotal: decimalString(i.approved_total),
    poQuantity: decimalString(i.po_quantity),
    orderedQuantity: decimalString(i.ordered_quantity),
    purchasedQuantity: decimalString(i.purchased_quantity),
    cancelledQuantity: decimalString(i.cancelled_quantity),
    actualTotal: decimalString(i.actual_total),
    reviewComment: i.review_comment,
    vendorName: i.vendor_name,
    priority: i.priority,
    essentialJustification: i.essential_justification,
  };
}
