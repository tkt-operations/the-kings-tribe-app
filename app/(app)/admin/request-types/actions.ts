"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { parseMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  description: z.string().trim().max(500).optional().default(""),
  help_text: z.string().trim().max(500).optional().default(""),
  workflow: z.enum(["church_order", "purchase_order", "reimbursement", "petty_cash", "advance_check"]),
  is_active: z.boolean(),
  is_default: z.boolean(),
  requires_receipt_on_submission: z.boolean(),
  requires_purchase_details: z.boolean(),
  requires_cost_center: z.boolean(),
  issues_purchase_order: z.boolean(),
  allows_vendor_orders: z.boolean(),
  requires_disbursement: z.boolean(),
  max_total: z.string().trim().refine((v) => v === "" || (parseMoney(v) ?? 0n) > 0n, "Limit must be an amount greater than 0").optional().default(""),
});

export async function saveRequestType(id: string | null, input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    await assertPermission("request_types.manage");
    const v = schema.parse(input);
    if (v.is_default && !v.is_active) throw new ActionError("The default request type must be active.");
    const row = { ...v, description: v.description || null, help_text: v.help_text || null, max_total: v.max_total ? v.max_total.replace(/[,$]/g, "") : null };
    const supabase = await createSupabaseServerClient();
    if (v.is_default) {
      // Only one default: clear the others first.
      const { error } = await supabase.from("request_types").update({ is_default: false }).neq("id", id ?? "00000000-0000-4000-8000-000000000000").eq("is_default", true);
      if (error) throw new ActionError(friendlyDbError(error));
    }
    if (id) {
      const { error } = await supabase.from("request_types").update(row).eq("id", z.uuid().parse(id));
      if (error) throw new ActionError(friendlyDbError(error));
    } else {
      const key = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "t_$1").slice(0, 40) || "request_type";
      const { error } = await supabase.from("request_types").insert({ ...row, key: `${key}_${Date.now().toString(36).slice(-4)}`, sort_order: 100 });
      if (error) throw new ActionError(friendlyDbError(error));
    }
    revalidatePath("/admin/request-types");
    return { ok: true, data: undefined, message: "Request type saved successfully." };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    return toActionError(e);
  }
}
