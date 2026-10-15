/**
 * Requisition amendments (Phase 1): shared rules and the change list sent to
 * public.amend_requisition. The database re-validates everything; this module
 * only decides what changed and how to describe it.
 */
import { isPriority, PRIORITY_LABELS, type Priority } from "@/lib/priority";
import type { RequisitionStatus } from "@/lib/workflow/status";

/** Phase 1: amendments are possible only before any review decision is final. */
export const AMENDABLE_STATUSES: readonly RequisitionStatus[] = ["submitted", "under_review", "on_hold"];

export function isAmendable(status: RequisitionStatus): boolean {
  return AMENDABLE_STATUSES.includes(status);
}

export const AMENDMENT_REASON_MIN = 10;
export const AMENDMENT_REASON_MAX = 1000;

/** The line fields an amendment may change, in display order. */
export const AMENDABLE_FIELDS = [
  "description", "quantity", "estimated_unit_price", "priority", "essential_justification",
  "vendor_name", "vendor_url", "requested_brand", "requested_model", "requested_sku", "specifications", "color", "size", "notes",
] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

export const FIELD_LABELS: Record<AmendableField, string> = {
  description: "Description",
  quantity: "Quantity",
  estimated_unit_price: "Unit price",
  priority: "Priority",
  essential_justification: "Why essential",
  vendor_name: "Vendor",
  vendor_url: "Product link",
  requested_brand: "Brand",
  requested_model: "Model",
  requested_sku: "SKU / product number",
  specifications: "Specifications",
  color: "Color",
  size: "Size",
  notes: "Notes",
};

/** A line as edited in the amendment form: every value is a string ("" = empty). */
export type LineDraft = Omit<Record<AmendableField, string>, "priority"> & { priority: Priority };

export interface ExistingLine extends LineDraft {
  id: string;
  line: number;
}

export type AmendmentChange =
  | { op: "update"; item_id: string; fields: Partial<LineDraft> }
  | { op: "add"; fields: LineDraft }
  | { op: "remove"; item_id: string; reason?: string };

/** Values compare as the database stores them: trimmed text, numbers by value. */
function normalize(field: AmendableField, value: string): string {
  const v = value.trim();
  if ((field === "quantity" || field === "estimated_unit_price") && v !== "" && Number.isFinite(Number(v))) return String(Number(v));
  return v;
}

/** The fields of `edited` that differ from `original` (non-essential lines carry no "why essential"). */
export function changedFields(original: LineDraft, edited: LineDraft): Partial<LineDraft> {
  const out: Partial<LineDraft> = {};
  for (const f of AMENDABLE_FIELDS) {
    if (f === "essential_justification" && edited.priority !== "essential") continue;
    if (normalize(f, original[f]) !== normalize(f, edited[f])) (out as Record<string, string>)[f] = edited[f].trim();
  }
  return out;
}

/** Build the change list: updates for changed lines, removals, then additions. */
export function buildAmendmentChanges(
  existing: ExistingLine[],
  edited: Record<string, LineDraft>,
  removed: Record<string, string>,
  added: LineDraft[],
): AmendmentChange[] {
  const changes: AmendmentChange[] = [];
  for (const line of existing) {
    if (line.id in removed) {
      const reason = removed[line.id].trim();
      changes.push(reason ? { op: "remove", item_id: line.id, reason } : { op: "remove", item_id: line.id });
      continue;
    }
    const draft = edited[line.id];
    if (!draft) continue;
    const fields = changedFields(line, draft);
    if (Object.keys(fields).length) changes.push({ op: "update", item_id: line.id, fields });
  }
  for (const a of added) {
    const fields = Object.fromEntries(AMENDABLE_FIELDS.map((f) => [f, a[f].trim()])) as unknown as LineDraft;
    if (fields.priority !== "essential") fields.essential_justification = "";
    changes.push({ op: "add", fields });
  }
  return changes;
}

/** Human-readable value for history and the review summary. */
export function displayValue(field: string, value: unknown, formatMoney: (v: string) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "priority" && isPriority(value)) return PRIORITY_LABELS[value as Priority];
  if (field === "estimated_unit_price" || field === "estimated_total") return formatMoney(String(value));
  if (field === "quantity") return String(value).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return String(value);
}

export const EMPTY_LINE: LineDraft = {
  description: "", quantity: "1", estimated_unit_price: "", priority: "medium", essential_justification: "",
  vendor_name: "", vendor_url: "", requested_brand: "", requested_model: "", requested_sku: "",
  specifications: "", color: "", size: "", notes: "",
};

/** Whether to offer "Amend requisition": the permission and an amendable status (Phase 1). */
export function canAmend(permissions: { has(p: "requisitions.amend"): boolean }, status: RequisitionStatus): boolean {
  return permissions.has("requisitions.amend") && isAmendable(status);
}

/**
 * React key for dialogs that copy the line items into their own state when
 * they mount (the review dialog). It changes with every amendment, so a saved
 * amendment always gives them fresh state built from the current lines.
 */
export function lineStateKey(prefix: string, status: RequisitionStatus, revision: number): string {
  return `${prefix}-${status}-r${revision}`;
}
