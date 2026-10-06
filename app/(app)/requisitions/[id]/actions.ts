"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { buildPurchaseOrderPdf } from "@/lib/data/purchase-order-pdf";
import { isIsoDate } from "@/lib/dates";
import { parseMoney, parseQuantity } from "@/lib/money";
import { notifyPurchaseOrderIssued, notifyReceiptReceived, notifyStatusChange } from "@/lib/notify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRequisitionStatus, type RequisitionStatus } from "@/lib/workflow/status";

const uuid = z.uuid();
const money = z.string().trim().refine((v) => parseMoney(v) !== null, "Enter an amount like 24.99");
const quantity = z.string().trim().refine((v) => parseQuantity(v) !== null, "Enter a quantity greater than 0");
const text = (max: number) => z.string().trim().max(max).optional().default("");

function zodMessage(e: z.ZodError) {
  return e.issues[0]?.message ?? "Check the values entered";
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ActionError(friendlyDbError(error));
  return data as T;
}

function refresh(requisitionId: string) {
  revalidatePath(`/requisitions/${requisitionId}`);
  revalidatePath("/requisitions");
  revalidatePath("/purchase-orders");
  revalidatePath("/receipts");
}

/** Email the requester when the status materially changed. */
function notifyIfChanged(requisitionId: string, previous: unknown, next: unknown, comment?: string | null) {
  if (typeof next !== "string" || !isRequisitionStatus(next) || previous === next) return;
  const status = next as RequisitionStatus;
  if (status === "po_issued") return; // the PO email covers this
  after(() => notifyStatusChange(requisitionId, status, comment));
}

async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: zodMessage(e) };
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------
export async function startReview(requisitionId: string) {
  return guarded(async () => {
    await assertPermission("requisitions.review");
    const r = await rpc<{ previous_status: string; status: string }>("start_requisition_review", { p_requisition_id: uuid.parse(requisitionId) });
    notifyIfChanged(requisitionId, r.previous_status, r.status);
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

const reviewSchema = z.object({
  decision: z.enum(["approve", "partial", "hold", "reject"]),
  comment: text(2000),
  cost_center_id: uuid.nullable().optional(),
  expense_category_id: uuid.nullable().optional(),
  items: z
    .array(
      z.object({
        item_id: uuid,
        decision: z.enum(["approved", "held", "rejected"]),
        approved_quantity: z.string().trim().optional(),
        approved_unit_price: z.string().trim().optional(),
        comment: text(1000),
      }),
    )
    .max(100),
});

export async function reviewRequisition(requisitionId: string, input: z.input<typeof reviewSchema>) {
  return guarded(async () => {
    await assertPermission("requisitions.review");
    const v = reviewSchema.parse(input);
    if ((v.decision === "hold" || v.decision === "reject") && !v.comment) throw new ActionError("A comment is required when holding or rejecting.");
    for (const item of v.items) {
      if (item.decision === "approved") {
        if (item.approved_quantity && parseQuantity(item.approved_quantity) === null) throw new ActionError("Approved quantities must be greater than 0.");
        if (item.approved_unit_price && parseMoney(item.approved_unit_price) === null) throw new ActionError("Approved prices must be amounts like 24.99.");
      }
    }
    const r = await rpc<{ previous_status: string; status: string }>("review_requisition", {
      p_requisition_id: uuid.parse(requisitionId),
      p_decision: v.decision,
      p_items: v.items.map((i) => ({ ...i, approved_quantity: i.approved_quantity || null, approved_unit_price: i.approved_unit_price || null, comment: i.comment || null })),
      p_comment: v.comment || null,
      p_cost_center_id: v.cost_center_id ?? null,
      p_expense_category_id: v.expense_category_id ?? null,
    });
    notifyIfChanged(requisitionId, r.previous_status, r.status, v.comment || null);
    refresh(requisitionId);
    return { ok: true, data: undefined, message: "Review saved." };
  });
}

export async function assignReviewer(requisitionId: string, reviewerId: string | null) {
  return guarded(async () => {
    await assertPermission("requisitions.review");
    await rpc("assign_requisition_reviewer", { p_requisition_id: uuid.parse(requisitionId), p_reviewer_id: reviewerId ? uuid.parse(reviewerId) : null });
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

export async function addComment(requisitionId: string, body: string) {
  return guarded(async () => {
    await assertPermission("requisitions.view");
    const b = z.string().trim().min(1, "Write a comment").max(4000).parse(body);
    await rpc("add_requisition_comment", { p_requisition_id: uuid.parse(requisitionId), p_body: b });
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
const poSchema = z.object({
  vendor: z.object({
    name: text(200),
    contact: text(200),
    email: z.string().trim().max(254).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid vendor email").optional().default(""),
    phone: text(40),
    address: text(500),
    url: z.string().trim().max(2000).refine((v) => v === "" || /^https?:\/\//i.test(v), "Vendor website must start with https://").optional().default(""),
  }),
  notes: text(2000),
  items: z.array(z.object({ requisition_item_id: uuid, quantity, unit_price: z.string().trim().optional() })).min(1, "Choose at least one line"),
});

async function storePdf(purchaseOrderId: string, version = 1) {
  const supabase = await createSupabaseServerClient();
  const { pdf, poNumber, requisitionId } = await buildPurchaseOrderPdf(supabase, purchaseOrderId);
  const path = `${requisitionId}/${poNumber}${version > 1 ? `-v${version}` : ""}.pdf`;
  const { error } = await supabase.storage.from("purchase-orders").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (error) throw new ActionError("The Purchase Order was issued but its PDF could not be stored. Use “Regenerate PDF”.");
  await rpc("set_purchase_order_pdf", { p_purchase_order_id: purchaseOrderId, p_path: path });
  return pdf;
}

export async function issuePurchaseOrder(requisitionId: string, input: z.input<typeof poSchema>) {
  return guarded(async () => {
    await assertPermission("purchase_orders.issue");
    const v = poSchema.parse(input);
    for (const i of v.items) if (i.unit_price && parseMoney(i.unit_price) === null) throw new ActionError("Unit prices must be amounts like 24.99.");
    const r = await rpc<{ id: string; po_number: string; total: string; previous_status: string; status: string }>("issue_purchase_order", {
      p_requisition_id: uuid.parse(requisitionId),
      p_items: v.items.map((i) => ({ ...i, unit_price: i.unit_price || null })),
      p_vendor: v.vendor,
      p_notes: v.notes || null,
    });
    let pdf: Buffer | null = null;
    let warning: string | undefined;
    try {
      pdf = await storePdf(r.id);
    } catch (e) {
      warning = e instanceof ActionError ? e.message : "The PDF could not be generated. Use “Regenerate PDF”.";
    }
    const supabase = await createSupabaseServerClient();
    const { data: po } = await supabase.from("purchase_orders").select("reply_token, purchase_order_items(description, quantity, line_total, line_number)").eq("id", r.id).single();
    const items = ((po?.purchase_order_items ?? []) as { description: string; quantity: string; line_total: string; line_number: number }[]).sort((a, b) => a.line_number - b.line_number);
    after(() => notifyPurchaseOrderIssued(requisitionId, { id: r.id, po_number: r.po_number, total: r.total, reply_token: po?.reply_token as string, items }, pdf));
    refresh(requisitionId);
    return { ok: true, data: { poNumber: r.po_number }, message: warning ?? `Purchase Order ${r.po_number} issued and emailed to the requester.` };
  });
}

export async function regeneratePurchaseOrderPdf(purchaseOrderId: string) {
  return guarded(async () => {
    await assertPermission("purchase_orders.issue");
    const supabase = await createSupabaseServerClient();
    const { data: po } = await supabase.from("purchase_orders").select("requisition_id, pdf_path").eq("id", uuid.parse(purchaseOrderId)).single();
    if (!po) throw new ActionError("Purchase Order not found.");
    const current = /-v(\d+)\.pdf$/.exec((po.pdf_path as string | null) ?? "");
    await storePdf(purchaseOrderId, po.pdf_path ? (current ? Number(current[1]) + 1 : 2) : 1);
    refresh(po.requisition_id as string);
    return { ok: true, data: undefined, message: "PDF regenerated." };
  });
}

export async function voidPurchaseOrder(requisitionId: string, purchaseOrderId: string, reason: string) {
  return guarded(async () => {
    await assertPermission("purchase_orders.issue");
    await rpc("void_purchase_order", { p_purchase_order_id: uuid.parse(purchaseOrderId), p_reason: z.string().trim().min(3, "Give a reason").max(500).parse(reason) });
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Vendor orders
// ---------------------------------------------------------------------------
const orderSchema = z.object({
  vendor_name: z.string().trim().min(1, "Vendor is required").max(200),
  vendor_reference: text(120),
  order_date: z.string().refine(isIsoDate, "Choose the order date"),
  expected_delivery_date: z.string().refine((v) => v === "" || isIsoDate(v), "Choose a valid date").optional().default(""),
  notes: text(2000),
  purchase_order_id: uuid.nullable().optional(),
  items: z.array(z.object({ requisition_item_id: uuid, quantity, unit_price: money.optional().or(z.literal("")) })).min(1, "Select at least one item"),
});

export async function recordVendorOrder(requisitionId: string, input: z.input<typeof orderSchema>) {
  return guarded(async () => {
    await assertPermission("orders.record");
    const v = orderSchema.parse(input);
    const r = await rpc<{ previous_status: string; status: string }>("record_vendor_order", {
      p_requisition_id: uuid.parse(requisitionId),
      p_order: { ...v, items: undefined, expected_delivery_date: v.expected_delivery_date || null, purchase_order_id: v.purchase_order_id ?? null },
      p_items: v.items.map((i) => ({ ...i, unit_price: i.unit_price || null })),
    });
    notifyIfChanged(requisitionId, r.previous_status, r.status);
    refresh(requisitionId);
    return { ok: true, data: undefined, message: "Order recorded." };
  });
}

export async function cancelVendorOrder(requisitionId: string, orderId: string, reason: string) {
  return guarded(async () => {
    await assertPermission("orders.record");
    await rpc("cancel_vendor_order", { p_vendor_order_id: uuid.parse(orderId), p_reason: z.string().trim().min(3, "Give a reason").max(500).parse(reason) });
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Receipts & reconciliation
// ---------------------------------------------------------------------------
const receiptSchema = z.object({
  purchase_order_id: uuid.nullable().optional(),
  vendor_name: text(200),
  purchase_date: z.string().refine((v) => v === "" || isIsoDate(v), "Choose a valid date").optional().default(""),
  total_amount: z.string().trim().refine((v) => v === "" || parseMoney(v) !== null, "Enter an amount like 24.99").optional().default(""),
  reference: text(200),
  notes: text(2000),
  files: z.array(z.object({ path: z.string().regex(/^requisitions\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png|heic|heif)$/), original_filename: z.string().max(255) })).min(1).max(5),
});

export async function registerReceipt(requisitionId: string, input: z.input<typeof receiptSchema>) {
  return guarded(async () => {
    await assertPermission("receipts.upload");
    const v = receiptSchema.parse(input);
    const id = uuid.parse(requisitionId);
    if (!v.files.every((f) => f.path.startsWith(`requisitions/${id}/`))) throw new ActionError("Invalid upload location.");
    await rpc("register_receipt", {
      p_requisition_id: id,
      p_purchase_order_id: v.purchase_order_id ?? null,
      p_details: { vendor_name: v.vendor_name, purchase_date: v.purchase_date || null, total_amount: v.total_amount.replace(/[,$]/g, ""), reference: v.reference, notes: v.notes },
      p_files: v.files,
    });
    after(() => notifyReceiptReceived(id, { source: "upload" }));
    refresh(id);
    return { ok: true, data: undefined, message: "Receipt uploaded. It is waiting for reconciliation." };
  });
}

const reconcileSchema = z.object({
  vendor_name: text(200),
  purchase_date: z.string().refine((v) => v === "" || isIsoDate(v), "Choose a valid date").optional().default(""),
  total_amount: z.string().trim().refine((v) => v === "" || parseMoney(v) !== null, "Enter an amount like 24.99").optional().default(""),
  reference: text(200),
  notes: text(2000),
  allocations: z
    .array(z.object({ requisition_item_id: uuid, quantity, actual_amount: money, purchase_order_item_id: uuid.nullable().optional() }))
    .min(1, "Enter the quantity purchased for at least one line"),
});

export async function reconcileReceipt(requisitionId: string, receiptId: string, input: z.input<typeof reconcileSchema>) {
  return guarded(async () => {
    await assertPermission("receipts.reconcile");
    const v = reconcileSchema.parse(input);
    const r = await rpc<{ previous_status: string; status: string; allocated_amount: string }>("reconcile_receipt", {
      p_receipt_id: uuid.parse(receiptId),
      p_allocations: v.allocations.map((a) => ({ ...a, actual_amount: a.actual_amount.replace(/[,$]/g, ""), purchase_order_item_id: a.purchase_order_item_id ?? null })),
      p_details: { vendor_name: v.vendor_name, purchase_date: v.purchase_date || null, total_amount: v.total_amount.replace(/[,$]/g, ""), reference: v.reference, notes: v.notes },
    });
    notifyIfChanged(requisitionId, r.previous_status, r.status);
    refresh(requisitionId);
    return { ok: true, data: undefined, message: r.status === "purchased" ? "Reconciled — all approved items are now accounted for." : "Receipt reconciled." };
  });
}

export async function rejectReceipt(requisitionId: string, receiptId: string, reason: string) {
  return guarded(async () => {
    await assertPermission("receipts.reconcile");
    await rpc("reject_receipt", { p_receipt_id: uuid.parse(receiptId), p_reason: z.string().trim().min(3, "Give a reason").max(500).parse(reason) });
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

export async function cancelRemaining(requisitionId: string, itemId: string, qty: string, reason: string) {
  return guarded(async () => {
    await assertPermission("receipts.reconcile");
    const r = await rpc<{ status: string }>("cancel_item_remaining", {
      p_item_id: uuid.parse(itemId),
      p_quantity: quantity.parse(qty),
      p_reason: z.string().trim().min(3, "Give a reason").max(500).parse(reason),
    });
    notifyIfChanged(requisitionId, null, r.status === "purchased" ? "purchased" : null);
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}

// ---------------------------------------------------------------------------
// Disbursements & closing
// ---------------------------------------------------------------------------
const disbursementSchema = z.object({
  amount: money,
  method: z.enum(["cash", "check", "bank_transfer", "other"]),
  paid_on: z.string().refine(isIsoDate, "Choose the payment date"),
  reference: text(120),
  notes: text(2000),
});

export async function recordDisbursement(requisitionId: string, input: z.input<typeof disbursementSchema>) {
  return guarded(async () => {
    await assertPermission("disbursements.record");
    const v = disbursementSchema.parse(input);
    await rpc("record_disbursement", {
      p_requisition_id: uuid.parse(requisitionId),
      p_amount: v.amount.replace(/[,$]/g, ""),
      p_method: v.method,
      p_paid_on: v.paid_on,
      p_reference: v.reference || null,
      p_notes: v.notes || null,
    });
    refresh(requisitionId);
    return { ok: true, data: undefined, message: "Disbursement recorded." };
  });
}

export async function closeRequisition(requisitionId: string, comment: string) {
  return guarded(async () => {
    await assertPermission("requisitions.review");
    const c = z.string().trim().max(2000).parse(comment);
    const r = await rpc<{ previous_status: string; status: string }>("close_requisition", { p_requisition_id: uuid.parse(requisitionId), p_comment: c || null });
    notifyIfChanged(requisitionId, r.previous_status, r.status, c || null);
    refresh(requisitionId);
    return { ok: true, data: undefined };
  });
}
