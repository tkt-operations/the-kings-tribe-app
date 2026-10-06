"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function assignUnmatchedReceipt(receiptId: string, requisitionNumber: string): Promise<ActionResult> {
  try {
    await assertPermission("receipts.reconcile");
    const number = z.string().trim().toUpperCase().regex(/^TKT-REQ-\d{4}-\d{4,}$/, "Enter a requisition number like TKT-REQ-2026-0001").parse(requisitionNumber);
    const supabase = await createSupabaseServerClient();
    const { data: req } = await supabase.from("requisitions").select("id").eq("requisition_number", number).maybeSingle();
    if (!req) throw new ActionError("No requisition with that number.");
    const { error } = await supabase.rpc("assign_receipt", { p_receipt_id: z.uuid().parse(receiptId), p_requisition_id: req.id, p_purchase_order_id: null });
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/receipts");
    revalidatePath(`/requisitions/${req.id}`);
    return { ok: true, data: undefined, message: `Assigned to ${number}.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}

export async function rejectUnmatchedReceipt(receiptId: string, reason: string): Promise<ActionResult> {
  try {
    await assertPermission("receipts.reconcile");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("reject_receipt", { p_receipt_id: z.uuid().parse(receiptId), p_reason: z.string().trim().min(3, "Give a reason").max(500).parse(reason) });
    if (error) throw new ActionError(friendlyDbError(error));
    revalidatePath("/receipts");
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}
