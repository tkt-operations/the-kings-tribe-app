import type { Priority } from "@/lib/priority";

export interface ItemModel {
  id: string;
  line: number;
  description: string;
  quantity: string;
  estimatedUnitPrice: string;
  reviewStatus: "pending" | "approved" | "held" | "rejected";
  approvedQuantity: string | null;
  approvedUnitPrice: string | null;
  approvedTotal: string;
  poQuantity: string;
  orderedQuantity: string;
  purchasedQuantity: string;
  cancelledQuantity: string;
  actualTotal: string;
  reviewComment: string | null;
  vendorName: string | null;
  priority: Priority;
  essentialJustification: string | null;
}
