"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { issuesToFieldErrors } from "@/lib/action-result";
import { setFlash } from "@/lib/flash-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UpdatePasswordState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const schema = z
  .object({
    full_name: z.string().trim().max(120).optional(),
    password: z.string().min(12, "Use at least 12 characters.").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function updatePassword(_prev: UpdatePasswordState, formData: FormData): Promise<UpdatePasswordState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Unable to save your password. Please review the form and try again.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Your link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.message.includes("different")) return { error: "Choose a password you have not used before.", fieldErrors: { password: "Choose a password you have not used before." } };
    console.error("Password update failed", { code: error.code, status: error.status });
    return { error: "Unable to update your password. Please try again." };
  }
  if (parsed.data.full_name) {
    const { error: profileError } = await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", auth.user.id);
    if (profileError) console.error("Profile name update failed", { code: profileError.code, message: profileError.message });
  }
  await setFlash("password-updated");
  redirect("/dashboard");
}
