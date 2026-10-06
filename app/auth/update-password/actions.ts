"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UpdatePasswordState = { error?: string } | undefined;

const schema = z
  .object({
    full_name: z.string().trim().max(120).optional(),
    password: z.string().min(12, "Use at least 12 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function updatePassword(_prev: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Your link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message.includes("different") ? "Choose a password you have not used before." : "Could not update your password." };
  }
  if (parsed.data.full_name) {
    await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", auth.user.id);
  }
  redirect("/dashboard");
}
