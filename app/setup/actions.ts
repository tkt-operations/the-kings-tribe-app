"use server";

import { timingSafeEqual, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";

export type SetupState = { error?: string } | undefined;

const schema = z
  .object({
    setup_token: z.string().min(1, "Enter the setup token"),
    full_name: z.string().trim().min(2, "Enter your full name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: z.string().min(12, "Use at least 12 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

function tokensMatch(provided: string, expected: string): boolean {
  // Compare fixed-length digests so timing does not reveal length or content.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createFirstAdministrator(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const { setupToken } = serverEnv();
  if (setupToken.length < 24) {
    return { error: "SETUP_TOKEN is not configured (it must be at least 24 characters). See SETUP-GUIDE.md." };
  }
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (!tokensMatch(parsed.data.setup_token, setupToken)) {
    await new Promise((r) => setTimeout(r, 750)); // slow down guessing
    return { error: "The setup token is not correct." };
  }

  const admin = createSupabaseAdminClient();
  const { data: exists } = await admin.rpc("administrator_exists");
  if (exists) return { error: "Setup has already been completed. Sign in instead." };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (createError || !created.user) {
    return { error: createError?.message.includes("already") ? "A user with that email already exists." : "Could not create the account." };
  }

  const { error: bootstrapError } = await admin.rpc("bootstrap_first_administrator", {
    p_user_id: created.user.id,
    p_full_name: parsed.data.full_name,
  });
  if (bootstrapError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: bootstrapError.code === "P0001" ? bootstrapError.message : "Could not finish setup." };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  redirect("/admin/setup");
}
