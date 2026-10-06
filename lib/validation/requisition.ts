/**
 * Requisition validation shared by the public form (instant feedback) and the
 * server action (authoritative). The database re-validates everything again.
 */
import { z } from "zod";
import { isIsoDate, addDays } from "@/lib/dates";
import { lineTotal, parseMoney, parseQuantity, sumCents } from "@/lib/money";
import { DEFAULT_PRIORITY, ESSENTIAL_JUSTIFICATION_MAX, ESSENTIAL_JUSTIFICATION_MIN, PRIORITIES } from "@/lib/priority";

export interface RequestTypeRuleSet {
  id: string;
  name: string;
  requires_receipt_on_submission: boolean;
  requires_purchase_details: boolean;
  requires_cost_center: boolean;
  max_total: string | null;
}

const PHONE = /^\+?[0-9 ().-]{7,25}$/;
const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional().or(z.literal(""));

export const lineItemSchema = z.object({
  description: z.string().trim().min(2, "Describe the item").max(300),
  specifications: optionalText(2000),
  color: optionalText(60),
  size: optionalText(60),
  quantity: z
    .string()
    .trim()
    .refine((v) => parseQuantity(v) !== null, "Enter a quantity greater than 0 (up to 2 decimals)")
    .refine((v) => (parseQuantity(v) ?? 0n) <= 10_000_000n, "Quantity is too large"),
  estimated_unit_price: z
    .string()
    .trim()
    .refine((v) => parseMoney(v) !== null, "Enter a price like 24.99"),
  vendor_name: optionalText(200),
  vendor_url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), "Enter a full web address starting with https://")
    .optional()
    .or(z.literal("")),
  notes: optionalText(2000),
  priority: z.enum(PRIORITIES, { error: "Choose a priority for this item" }),
  essential_justification: z.string().trim().max(ESSENTIAL_JUSTIFICATION_MAX, `Keep this under ${ESSENTIAL_JUSTIFICATION_MAX} characters`).optional().or(z.literal("")),
}).superRefine((item, issue) => {
  if (item.priority === "essential" && (item.essential_justification ?? "").trim().length < ESSENTIAL_JUSTIFICATION_MIN) {
    issue.addIssue({
      code: "custom",
      path: ["essential_justification"],
      message: (item.essential_justification ?? "").trim()
        ? `Explain why this item is essential (at least ${ESSENTIAL_JUSTIFICATION_MIN} characters)`
        : "Explain why this item is essential",
    });
  }
});

/** A blank line item for the form; every new line gets its own priority. */
export const EMPTY_LINE_ITEM = {
  description: "", specifications: "", color: "", size: "", quantity: "1", estimated_unit_price: "",
  vendor_name: "", vendor_url: "", notes: "", priority: DEFAULT_PRIORITY, essential_justification: "",
} satisfies LineItemInput;

export type LineItemInput = z.infer<typeof lineItemSchema>;

export function buildRequisitionSchema(ctx: { today: string; requestTypes: RequestTypeRuleSet[] }) {
  return z
    .object({
      requester_name: z.string().trim().min(2, "Enter your full name").max(120),
      requester_email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
      requester_phone: z
        .string()
        .trim()
        .regex(PHONE, "Enter a valid phone number")
        .refine((v) => (v.match(/\d/g) ?? []).length >= 7, "Enter a valid phone number"),
      department_head_name: z.string().trim().min(2, "Enter the department head's name").max(120),
      department_id: z.uuid("Choose a department"),
      subcategory_id: z.uuid("Choose a subcategory"),
      request_type_id: z.uuid("Choose a request type"),
      cost_center_id: z.uuid().optional().or(z.literal("")),
      needed_by: z
        .string()
        .refine(isIsoDate, "Choose the date needed")
        .refine((v) => v >= ctx.today, "The date needed cannot be in the past")
        .refine((v) => v <= addDays(ctx.today, 730), "Choose a date within the next two years"),
      budget_status: z.enum(["yes", "no", "unsure"], { error: "Answer the budget question" }),
      budget_explanation: optionalText(2000),
      justification: z
        .string()
        .trim()
        .min(20, "Please describe how this supports your ministry (at least 20 characters)")
        .max(4000),
      actual_purchase_amount: z.string().trim().optional().or(z.literal("")),
      purchase_vendor: optionalText(200),
      purchase_date: z.string().optional().or(z.literal("")),
      items: z.array(lineItemSchema).min(1, "Add at least one item").max(50, "A requisition can contain at most 50 items"),
      certification_accepted: z.literal(true, { error: "You must accept the certification to submit" }),
      certification_name: z.string().trim().min(2, "Type your full name").max(120),
      sms_opt_in: z.boolean().optional(),
      receipt_count: z.number().int().min(0).max(10).optional(),
    })
    .superRefine((v, issue) => {
      if (v.budget_status !== "yes" && (v.budget_explanation ?? "").trim().length < 5) {
        issue.addIssue({ code: "custom", path: ["budget_explanation"], message: "Please explain the budget situation" });
      }
      const type = ctx.requestTypes.find((t) => t.id === v.request_type_id);
      if (!type) {
        issue.addIssue({ code: "custom", path: ["request_type_id"], message: "Choose a request type" });
        return;
      }
      if (type.requires_cost_center && !v.cost_center_id) {
        issue.addIssue({ code: "custom", path: ["cost_center_id"], message: "Choose a budget line / cost center" });
      }
      if (type.requires_purchase_details) {
        const amount = parseMoney(v.actual_purchase_amount ?? "");
        if (amount === null || amount <= 0n) {
          issue.addIssue({ code: "custom", path: ["actual_purchase_amount"], message: "Enter the actual amount paid" });
        }
        if ((v.purchase_vendor ?? "").trim().length < 2) {
          issue.addIssue({ code: "custom", path: ["purchase_vendor"], message: "Enter the vendor" });
        }
        if (!isIsoDate(v.purchase_date ?? "") || (v.purchase_date ?? "") > ctx.today || (v.purchase_date ?? "") < addDays(ctx.today, -365)) {
          issue.addIssue({ code: "custom", path: ["purchase_date"], message: "Enter the purchase date (within the last 12 months)" });
        }
      }
      if (type.requires_receipt_on_submission && (v.receipt_count ?? 0) < 1) {
        issue.addIssue({ code: "custom", path: ["receipt_count"], message: "Upload the itemized receipt" });
      }
      if (type.max_total) {
        const max = parseMoney(type.max_total);
        const total = estimatedTotal(v.items);
        if (max !== null && total !== null && total > max) {
          issue.addIssue({ code: "custom", path: ["items"], message: `${type.name} requests are limited to ${type.max_total}` });
        }
      }
    });
}

export type RequisitionInput = z.infer<ReturnType<typeof buildRequisitionSchema>>;

/** Exact estimated total (cents) or null if any line is incomplete. */
export function estimatedTotal(items: { quantity: string; estimated_unit_price: string }[]): bigint | null {
  const totals: bigint[] = [];
  for (const item of items) {
    const q = parseQuantity(item.quantity);
    const p = parseMoney(item.estimated_unit_price);
    if (q === null || p === null) return null;
    totals.push(lineTotal(q, p));
  }
  return sumCents(totals);
}

/** Shape sent to the database function (strings for every number — never floats). */
export function toDatabasePayload(v: RequisitionInput) {
  const blank = (s?: string) => (s && s.trim() ? s.trim() : null);
  return {
    request_type_id: v.request_type_id,
    department_id: v.department_id,
    subcategory_id: v.subcategory_id,
    cost_center_id: blank(v.cost_center_id),
    requester_name: v.requester_name,
    requester_email: v.requester_email,
    requester_phone: v.requester_phone,
    department_head_name: v.department_head_name,
    needed_by: v.needed_by,
    budget_status: v.budget_status,
    budget_explanation: v.budget_status === "yes" ? null : blank(v.budget_explanation),
    justification: v.justification,
    certification_accepted: true,
    certification_name: v.certification_name,
    actual_purchase_amount: blank(v.actual_purchase_amount)?.replace(/[,$]/g, "") ?? null,
    purchase_vendor: blank(v.purchase_vendor),
    purchase_date: blank(v.purchase_date),
    sms_opt_in: Boolean(v.sms_opt_in),
    items: v.items.map((i) => ({
      description: i.description,
      specifications: blank(i.specifications),
      color: blank(i.color),
      size: blank(i.size),
      quantity: i.quantity.replace(/,/g, ""),
      estimated_unit_price: i.estimated_unit_price.replace(/[,$]/g, ""),
      vendor_name: blank(i.vendor_name),
      vendor_url: blank(i.vendor_url),
      notes: blank(i.notes),
      priority: i.priority,
      essential_justification: i.priority === "essential" ? blank(i.essential_justification) : null,
    })),
  };
}
