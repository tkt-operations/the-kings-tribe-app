"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { publicEnv } from "@/lib/env";
import { issuesToFieldErrors } from "@/lib/action-result";
import { setFlash } from "@/lib/flash-server";

export type AuthFormState = { error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required.").max(200),
  next: z.string().optional(),
});

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Sign in failed. Please check your email and password.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error || !signedIn.user) {
    // Same message for unknown user / wrong password (no account enumeration).
    return { error: "Sign in failed. Please check your email and password." };
  }
  const { data: profile } = await supabase.from("profiles").select("is_active, account_setup_completed_at").eq("id", signedIn.user.id).maybeSingle();
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return { error: "Your account has been deactivated. Contact an administrator." };
  }
  // A password sign-in proves the person knows their own password (an invitee's
  // temporary password is random and never shown), so setup is complete.
  if (profile && !profile.account_setup_completed_at) {
    const { error: setupError } = await supabase.rpc("mark_account_setup_complete", { p_method: "password_sign_in" });
    if (setupError) console.error("Account setup marker failed", { code: setupError.code });
  }
  await setFlash("signed-in");
  redirect(safeRedirectPath(parsed.data.next));
}

const resetSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.") });

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email address.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().appUrl}/auth/callback?next=/auth/update-password`,
  });
  // Always the same response, whether or not the account exists.
  return { message: "If that email belongs to an account, a reset link is on its way." };
}
