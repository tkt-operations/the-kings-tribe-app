"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth";
import { ActionError, friendlyDbError, toActionError, type ActionResult } from "@/lib/action-result";
import { isIsoDate } from "@/lib/dates";
import { parseMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  service_date: z.string().refine(isIsoDate, "Choose a valid date"),
  service_name: z.string().trim().min(1, "Service name is required").max(80),
  attendance: z
    .array(z.object({ category_id: z.uuid(), count: z.string().trim().regex(/^\d{0,7}$/, "Attendance must be a whole number") }))
    .max(100)
    .optional(),
  finance: z
    .array(
      z.object({
        category_id: z.uuid(),
        subcategory_id: z.uuid().nullable(),
        amount: z.string().trim().max(20),
        notes: z.string().trim().max(1000).optional(),
      }),
    )
    .max(200)
    .optional(),
});

export type SundayInput = z.infer<typeof schema>;

export async function saveSundayEntry(input: SundayInput): Promise<ActionResult<{ attendanceTotal: number; financeTotal: string }>> {
  try {
    const user = await assertPermission(["attendance.enter", "finance.enter"]);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check the values entered");
    const data = parsed.data;

    for (const row of data.finance ?? []) {
      if (row.amount !== "" && parseMoney(row.amount, { allowNegative: true }) === null) {
        throw new ActionError("Amounts must be numbers with at most 2 decimal places.");
      }
    }

    const canAttendance = user.permissions.has("attendance.enter");
    const canFinance = user.permissions.has("finance.enter");
    const supabase = await createSupabaseServerClient();
    const { data: result, error } = await supabase.rpc("save_sunday_entry", {
      p_service_date: data.service_date,
      p_service_name: data.service_name,
      p_attendance: canAttendance ? (data.attendance ?? []) : null,
      p_finance: canFinance
        ? (data.finance ?? []).map((f) => ({ ...f, amount: f.amount.replace(/[,$]/g, "") }))
        : null,
      p_notes: null,
    });
    if (error) throw new ActionError(friendlyDbError(error));

    revalidatePath("/sunday");
    revalidatePath("/dashboard");
    const r = result as { attendance_total: number; finance_total: string };
    return { ok: true, data: { attendanceTotal: Number(r.attendance_total), financeTotal: r.finance_total }, message: "Sunday report saved successfully." };
  } catch (error) {
    return toActionError(error);
  }
}
